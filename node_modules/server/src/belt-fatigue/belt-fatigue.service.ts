import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'events';
import { DtwService } from '../dtw/dtw.service';
import {
  BeltFatigueAlarm,
  BeltFatigueBaseline,
  MotorTorqueSample,
  OhtVerticalState,
  OhtWarningState,
  VerticalActionState,
} from '../common/types';

@Injectable()
export class BeltFatigueService extends EventEmitter implements OnModuleInit {
  private readonly logger = new Logger(BeltFatigueService.name);

  static readonly DTW_THRESHOLD = 42.5;
  static readonly MAX_SAMPLES_PER_ACTION = 400;
  static readonly MIN_SAMPLES_FOR_DETECTION = 80;
  static readonly SAMPLE_RATE_HZ = 100;

  private baselines: Map<string, BeltFatigueBaseline> = new Map();
  private verticalStates: Map<string, OhtVerticalState> = new Map();
  private activeAlarms: Map<string, BeltFatigueAlarm> = new Map();
  private alarmHistory: BeltFatigueAlarm[] = [];
  private defaultBaseline: BeltFatigueBaseline;

  constructor(private readonly dtwService: DtwService) {
    super();
  }

  onModuleInit() {
    this.defaultBaseline = this.generateDefaultBaseline();
    this.baselines.set(this.defaultBaseline.id, this.defaultBaseline);
    this.logger.log(
      `BeltFatigueService initialized: threshold=${BeltFatigueService.DTW_THRESHOLD}, baselines=${this.baselines.size}`,
    );
  }

  private generateDefaultBaseline(): BeltFatigueBaseline {
    const sampleRate = BeltFatigueService.SAMPLE_RATE_HZ;
    const durationMs = 4000;
    const numSamples = Math.floor((durationMs / 1000) * sampleRate);
    const torqueWaveform: number[] = [];
    const vibrationWaveform: number[] = [];

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const phase = t / (durationMs / 1000);

      let torque = 0;
      if (phase < 0.1) {
        torque = 2.5 * (phase / 0.1);
      } else if (phase < 0.7) {
        torque = 2.5 + Math.sin(phase * Math.PI * 4) * 0.3;
      } else if (phase < 0.85) {
        torque = 2.5 + (phase - 0.7) / 0.15 * 4.5;
      } else {
        torque = 7.0 + Math.sin(phase * Math.PI * 8) * 0.5;
      }
      torque += (Math.random() - 0.5) * 0.15;
      torqueWaveform.push(torque);

      let vib = 0;
      if (phase < 0.1) {
        vib = 0.05 * (phase / 0.1);
      } else if (phase < 0.85) {
        vib = 0.05 + Math.sin(phase * Math.PI * 12) * 0.02;
      } else {
        vib = 0.15 + Math.sin(phase * Math.PI * 20) * 0.08;
      }
      vib += (Math.random() - 0.5) * 0.01;
      vibrationWaveform.push(vib);
    }

    return {
      id: 'baseline-factory-calibration-v1',
      name: 'Factory Calibration Baseline (4s Descend + Grasp)',
      durationMs,
      sampleRateHz: sampleRate,
      torqueWaveform: this.dtwService.smooth(torqueWaveform, 3),
      vibrationWaveform: this.dtwService.smooth(vibrationWaveform, 3),
      createdAt: Date.now(),
    };
  }

  startVerticalAction(ohtId: string, actionType: 'DESCEND_GRASP' | 'ASCEND_PLACE' = 'DESCEND_GRASP'): OhtVerticalState {
    const state: OhtVerticalState = {
      ohtId,
      actionState: actionType === 'DESCEND_GRASP' ? VerticalActionState.DESCENDING : VerticalActionState.ASCENDING,
      zPosition: 1000,
      targetZ: 0,
      currentTorque: 0,
      currentVibration: 0,
      samples: [],
      actionStartTime: Date.now(),
      lastSampleTime: 0,
    };
    this.verticalStates.set(ohtId, state);
    this.logger.debug(`Vertical action started: ${ohtId} (${actionType})`);
    return state;
  }

  ingestSample(ohtId: string, sample: MotorTorqueSample): OhtWarningState {
    let state = this.verticalStates.get(ohtId);

    if (!state) {
      state = this.startVerticalAction(ohtId, 'DESCEND_GRASP');
    }

    state.samples.push(sample);
    state.currentTorque = sample.torque;
    state.currentVibration = sample.zVibration;
    state.zPosition = sample.zPosition;
    state.lastSampleTime = sample.timestamp;

    if (state.samples.length > BeltFatigueService.MAX_SAMPLES_PER_ACTION) {
      state.samples = state.samples.slice(-BeltFatigueService.MAX_SAMPLES_PER_ACTION);
    }

    if (state.samples.length >= BeltFatigueService.MIN_SAMPLES_FOR_DETECTION) {
      const result = this.performDtwCheck(state);
      if (result.alarm) {
        this.triggerAlarm(ohtId, result.alarm);
        return 'BELT_FATIGUE';
      }
    }

    return 'NONE';
  }

  private performDtwCheck(
    state: OhtVerticalState,
  ): { alarm: BeltFatigueAlarm | null; distance: number } {
    const torqueWaveform = state.samples.map((s) => s.torque);

    const baseline = this.defaultBaseline;
    const targetLen = Math.min(torqueWaveform.length, baseline.torqueWaveform.length);

    const testTorque = this.dtwService.resample(torqueWaveform, targetLen);
    const baseTorque = this.dtwService.resample(baseline.torqueWaveform, targetLen);

    const testNorm = this.dtwService.zNormalize(testTorque);
    const baseNorm = this.dtwService.zNormalize(baseTorque);

    const distance = this.dtwService.computeFast(testNorm, baseNorm);
    const normalizedDistance = distance / targetLen;

    if (normalizedDistance > BeltFatigueService.DTW_THRESHOLD / 10) {
      const alarm: BeltFatigueAlarm = {
        id: `alarm-${state.ohtId}-${Date.now()}`,
        ohtId: state.ohtId,
        dtwDistance: normalizedDistance,
        threshold: BeltFatigueService.DTW_THRESHOLD / 10,
        baselineId: baseline.id,
        torqueWaveform: [...testTorque],
        baselineTorqueWaveform: [...baseTorque],
        vibrationWaveform: state.samples.map((s) => s.zVibration),
        baselineVibrationWaveform: [...baseline.vibrationWaveform.slice(0, targetLen)],
        timestamp: Date.now(),
        acknowledged: false,
        actionTaken: 'NONE',
      };
      return { alarm, distance: normalizedDistance };
    }

    return { alarm: null, distance: normalizedDistance };
  }

  private triggerAlarm(ohtId: string, alarm: BeltFatigueAlarm) {
    const existing = this.activeAlarms.get(ohtId);
    if (existing && !existing.acknowledged) {
      return;
    }

    this.activeAlarms.set(ohtId, alarm);
    this.alarmHistory.push(alarm);
    if (this.alarmHistory.length > 100) {
      this.alarmHistory = this.alarmHistory.slice(-100);
    }

    this.logger.warn(
      `⚠️  BELT FATIGUE ALARM: ${ohtId}, DTW=${alarm.dtwDistance.toFixed(2)}, threshold=${alarm.threshold.toFixed(2)}`,
    );

    this.emit('belt-fatigue-alarm', alarm);
  }

  acknowledgeAlarm(ohtId: string): boolean {
    const alarm = this.activeAlarms.get(ohtId);
    if (alarm) {
      alarm.acknowledged = true;
      this.logger.log(`Alarm acknowledged: ${ohtId}`);
      this.emit('alarm-updated', alarm);
      return true;
    }
    return false;
  }

  setActionTaken(ohtId: string, action: BeltFatigueAlarm['actionTaken']): boolean {
    const alarm = this.activeAlarms.get(ohtId);
    if (alarm) {
      alarm.actionTaken = action;
      this.emit('alarm-updated', alarm);
      return true;
    }
    return false;
  }

  clearAlarm(ohtId: string): boolean {
    const removed = this.activeAlarms.delete(ohtId);
    if (removed) {
      this.logger.log(`Alarm cleared: ${ohtId}`);
      this.emit('alarm-cleared', ohtId);
    }
    return removed;
  }

  getActiveAlarm(ohtId: string): BeltFatigueAlarm | undefined {
    return this.activeAlarms.get(ohtId);
  }

  getAllActiveAlarms(): BeltFatigueAlarm[] {
    return Array.from(this.activeAlarms.values());
  }

  getAlarmHistory(): BeltFatigueAlarm[] {
    return [...this.alarmHistory];
  }

  getVerticalState(ohtId: string): OhtVerticalState | undefined {
    return this.verticalStates.get(ohtId);
  }

  getAllVerticalStates(): OhtVerticalState[] {
    return Array.from(this.verticalStates.values());
  }

  getBaselines(): BeltFatigueBaseline[] {
    return Array.from(this.baselines.values());
  }

  getDefaultBaseline(): BeltFatigueBaseline {
    return this.defaultBaseline;
  }

  getWarningState(ohtId: string): OhtWarningState {
    const alarm = this.activeAlarms.get(ohtId);
    if (!alarm) return 'NONE';
    if (alarm.actionTaken === 'EMERGENCY_DETACH') return 'EMERGENCY';
    if (alarm.acknowledged) return 'VIBRATION_ANOMALY';
    return 'BELT_FATIGUE';
  }

  endVerticalAction(ohtId: string) {
    const state = this.verticalStates.get(ohtId);
    if (state) {
      state.actionState = VerticalActionState.IDLE;
      this.logger.debug(
        `Vertical action ended: ${ohtId}, samples=${state.samples.length}, duration=${Date.now() - state.actionStartTime}ms`,
      );
    }
  }
}
