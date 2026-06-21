import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'events';
import { Interval } from '@nestjs/schedule';
import { BeltFatigueService } from '../belt-fatigue/belt-fatigue.service';
import { HsmsService } from '../hsms/hsms.service';
import { MotorTorqueSample, OhtWarningState } from '../common/types';

@Injectable()
export class VibrationIngestService extends EventEmitter implements OnModuleInit {
  private readonly logger = new Logger(VibrationIngestService.name);

  private readonly SAMPLE_INTERVAL_MS = 10;
  private readonly MAX_BUFFER_SIZE = 1000;

  private sampleBuffer: Map<string, MotorTorqueSample[]> = new Map();
  private trackedOhts: Set<string> = new Set();
  private injectionMap: Map<string, { enabled: boolean; severity: number }> = new Map();

  constructor(
    private readonly beltFatigueService: BeltFatigueService,
    private readonly hsmsService: HsmsService,
  ) {
    super();
  }

  onModuleInit() {
    this.beltFatigueService.on('belt-fatigue-alarm', (alarm) => {
      this.handleBeltFatigueAlarm(alarm);
    });

    this.logger.log('Vibration Ingest Service initialized (100Hz sample rate)');
  }

  private handleBeltFatigueAlarm(alarm: any) {
    this.logger.error(
      `⛔ BELT FATIGUE DETECTED on ${alarm.ohtId} - DTW=${alarm.dtwDistance.toFixed(2)} > ${alarm.threshold.toFixed(2)}`,
    );

    const success = this.hsmsService.sendEmergencyDetach(alarm.ohtId, 'ST-09');
    if (success) {
      this.beltFatigueService.setActionTaken(alarm.ohtId, 'DIVER_TO_ST09');
    }

    this.emit('alarm-triggered', alarm);
  }

  ingestSample(ohtId: string, sample: MotorTorqueSample): OhtWarningState {
    let buffer = this.sampleBuffer.get(ohtId);
    if (!buffer) {
      buffer = [];
      this.sampleBuffer.set(ohtId, buffer);
      this.trackedOhts.add(ohtId);
    }

    buffer.push(sample);
    if (buffer.length > this.MAX_BUFFER_SIZE) {
      buffer.shift();
    }

    const warningState = this.beltFatigueService.ingestSample(ohtId, sample);

    this.emit('sample-received', { ohtId, sample, warningState });

    return warningState;
  }

  ingestBatch(ohtId: string, samples: MotorTorqueSample[]): OhtWarningState {
    let lastState: OhtWarningState = 'NONE';
    for (const sample of samples) {
      lastState = this.ingestSample(ohtId, sample);
    }
    return lastState;
  }

  injectAnomaly(ohtId: string, severity: number = 1.0): boolean {
    this.injectionMap.set(ohtId, { enabled: true, severity });
    this.logger.warn(`Anomaly injection enabled for ${ohtId}, severity=${severity}`);
    return true;
  }

  stopInjection(ohtId: string): boolean {
    const removed = this.injectionMap.delete(ohtId);
    if (removed) {
      this.logger.log(`Anomaly injection stopped for ${ohtId}`);
    }
    return removed;
  }

  getInjectionStatus(ohtId: string): { enabled: boolean; severity: number } {
    return this.injectionMap.get(ohtId) || { enabled: false, severity: 0 };
  }

  getSampleBuffer(ohtId: string): MotorTorqueSample[] {
    return [...(this.sampleBuffer.get(ohtId) || [])];
  }

  getTrackedOhts(): string[] {
    return Array.from(this.trackedOhts);
  }

  generateSimulatedSample(
    ohtId: string,
    phase: number,
    isDescending: boolean = true,
  ): MotorTorqueSample {
    const injection = this.injectionMap.get(ohtId);
    const hasAnomaly = injection?.enabled;
    const severity = injection?.severity || 1.0;

    let torque: number;
    let vibration: number;
    let zPosition: number;

    if (isDescending) {
      zPosition = 1000 * (1 - phase);

      if (phase < 0.1) {
        torque = 2.5 * (phase / 0.1);
        vibration = 0.05 * (phase / 0.1);
      } else if (phase < 0.7) {
        torque = 2.5 + Math.sin(phase * Math.PI * 4) * 0.3;
        vibration = 0.05 + Math.sin(phase * Math.PI * 12) * 0.02;
      } else if (phase < 0.85) {
        torque = 2.5 + ((phase - 0.7) / 0.15) * 4.5;
        vibration = 0.08 + ((phase - 0.7) / 0.15) * 0.1;
      } else {
        torque = 7.0 + Math.sin(phase * Math.PI * 8) * 0.5;
        vibration = 0.18 + Math.sin(phase * Math.PI * 20) * 0.08;
      }

      if (hasAnomaly) {
        const fatigueFactor = 1 + severity * 0.8;
        torque *= fatigueFactor;
        vibration *= 1 + severity * 1.5;
        torque += Math.sin(phase * Math.PI * 25) * 0.8 * severity;
        vibration += Math.abs(Math.sin(phase * Math.PI * 40)) * 0.15 * severity;
      }

      torque += (Math.random() - 0.5) * 0.15;
      vibration += (Math.random() - 0.5) * 0.015;
    } else {
      zPosition = 1000 * phase;
      torque = 3.0 + Math.sin(phase * Math.PI * 2) * 0.5;
      vibration = 0.06 + Math.sin(phase * Math.PI * 10) * 0.02;

      if (hasAnomaly) {
        torque *= 1 + severity * 0.6;
        vibration *= 1 + severity * 1.2;
      }
      torque += (Math.random() - 0.5) * 0.1;
      vibration += (Math.random() - 0.5) * 0.01;
    }

    return {
      timestamp: Date.now(),
      torque: Math.max(0, torque),
      zVibration: Math.max(0, vibration),
      zPosition: Math.max(0, Math.min(1000, zPosition)),
    };
  }

  @Interval(100)
  emitStatusSummary() {
    const tracked = this.trackedOhts.size;
    const alarms = this.beltFatigueService.getAllActiveAlarms().length;
    if (tracked > 0) {
      this.logger.debug(`Vibration ingest: ${tracked} OHTs tracked, ${alarms} active alarms`);
    }
  }
}
