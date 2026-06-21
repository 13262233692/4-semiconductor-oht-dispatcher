import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { StateBufferService } from '../state-buffer/state-buffer.service';
import { RoutingService } from '../routing/routing.service';
import { FoupState, S6F11EventReport, OhtStatus } from '../common/types';
import { EventEmitter } from 'events';

@Injectable()
export class OhtSimulatorService extends EventEmitter implements OnModuleInit {
  private readonly logger = new Logger(OhtSimulatorService.name);
  private readonly OHT_COUNT: number;
  private readonly GRID_COLS: number;
  private readonly GRID_ROWS: number;
  private readonly ENABLED: boolean;

  private ohtInternalStates: Map<string, {
    currentGridX: number;
    currentGridY: number;
    prevGridX: number;
    prevGridY: number;
    progress: number;
    targetGridX: number;
    targetGridY: number;
    speed: number;
    foupState: FoupState;
    foupId?: string;
    waitCounter: number;
    routeRefreshCounter: number;
  }> = new Map();

  private stationPositions: { x: number; y: number; id: string }[] = [];

  constructor(
    private readonly stateBuffer: StateBufferService,
    private readonly routingService: RoutingService,
  ) {
    super();
    this.OHT_COUNT = parseInt(process.env.OHT_COUNT || '120', 10);
    this.GRID_COLS = parseInt(process.env.GRID_COLS || '40', 10);
    this.GRID_ROWS = parseInt(process.env.GRID_ROWS || '30', 10);
    this.ENABLED = process.env.SIMULATOR_ENABLED !== 'false';
  }

  onModuleInit() {
    if (!this.ENABLED) {
      this.logger.log('OHT Simulator disabled');
      return;
    }

    this.discoverStations();
    this.initializeOhts();
    this.logger.log(`OHT Simulator initialized with ${this.OHT_COUNT} virtual OHTs (${this.stationPositions.length} stations)`);
  }

  private discoverStations() {
    const grid = this.stateBuffer.getGrid();
    for (let y = 0; y < this.GRID_ROWS; y++) {
      for (let x = 0; x < this.GRID_COLS; x++) {
        const cell = grid[y][x];
        if (cell.type === 'STATION' && cell.stationId) {
          this.stationPositions.push({ x, y, id: cell.stationId });
        }
      }
    }
    this.logger.debug(`Discovered ${this.stationPositions.length} stations`);
  }

  private initializeOhts() {
    for (let i = 0; i < this.OHT_COUNT; i++) {
      const ohtId = `OHT-${String(i + 1).padStart(4, '0')}`;
      let startX: number, startY: number;
      let attempts = 0;

      do {
        startX = Math.floor(Math.random() * this.GRID_COLS);
        startY = Math.floor(Math.random() * this.GRID_ROWS);
        attempts++;
      } while (
        attempts < 100 &&
        this.stateBuffer.getCell(startX, startY)?.type === 'BLOCKED'
      );

      const target = this.pickRandomTarget(startX, startY);
      const hasFoup = Math.random() < 0.5;

      this.ohtInternalStates.set(ohtId, {
        currentGridX: startX,
        currentGridY: startY,
        prevGridX: startX,
        prevGridY: startY,
        progress: 0,
        targetGridX: target.x,
        targetGridY: target.y,
        speed: 1.0 + Math.random() * 2.5,
        foupState: hasFoup ? FoupState.LOADED : FoupState.EMPTY,
        foupId: hasFoup ? `F-${String(Math.floor(Math.random() * 9000 + 1000))}` : undefined,
        waitCounter: 0,
        routeRefreshCounter: Math.floor(Math.random() * 50),
      });

      this.routingService.assignRoute(ohtId, target.x, target.y);
      this.emitS6F11Report(ohtId, startX, startY, this.ohtInternalStates.get(ohtId)!.speed, 0, hasFoup ? FoupState.LOADED : FoupState.EMPTY, hasFoup ? this.ohtInternalStates.get(ohtId)!.foupId : undefined);
    }
  }

  private pickRandomTarget(fromX: number, fromY: number): { x: number; y: number } {
    const useStation = Math.random() < 0.6 && this.stationPositions.length > 0;
    if (useStation) {
      const candidates = [...this.stationPositions].sort(() => Math.random() - 0.5).slice(0, 10);
      let best = candidates[0];
      let bestDist = Infinity;
      for (const s of candidates) {
        const dist = Math.abs(s.x - fromX) + Math.abs(s.y - fromY);
        if (dist > 5 && dist < bestDist) {
          bestDist = dist;
          best = s;
        }
      }
      return { x: best.x, y: best.y };
    }

    let tx: number, ty: number, attempts = 0;
    do {
      tx = Math.floor(Math.random() * this.GRID_COLS);
      ty = Math.floor(Math.random() * this.GRID_ROWS);
      attempts++;
    } while (
      attempts < 50 &&
      (this.stateBuffer.getCell(tx, ty)?.type === 'BLOCKED' ||
        (Math.abs(tx - fromX) + Math.abs(ty - fromY) < 5))
    );

    return { x: tx, y: ty };
  }

  @Interval(40)
  simulateTick() {
    if (!this.ENABLED) return;

    this.ohtInternalStates.forEach((state, ohtId) => {
      this.processOhtMovement(ohtId, state);
    });
  }

  private processOhtMovement(ohtId: string, state: any) {
    if (state.waitCounter > 0) {
      state.waitCounter--;
      this.emitS6F11Report(
        ohtId,
        state.currentGridX,
        state.currentGridY,
        0,
        state.direction || 0,
        state.foupState,
        state.foupId,
      );
      return;
    }

    state.routeRefreshCounter++;
    if (state.routeRefreshCounter > 80) {
      state.routeRefreshCounter = 0;
      const oht = this.stateBuffer.getOht(ohtId);
      if (oht && (!oht.assignedRoute || oht.assignedRoute.length === 0)) {
        this.routingService.assignRoute(ohtId, state.targetGridX, state.targetGridY);
      }
    }

    const oht = this.stateBuffer.getOht(ohtId);
    if (!oht || !oht.assignedRoute || oht.assignedRoute.length === 0) {
      return;
    }

    const segIdx = oht.currentSegmentIndex || 0;
    if (segIdx >= oht.assignedRoute.length) {
      this.handleArrival(ohtId, state);
      return;
    }

    const seg = oht.assignedRoute[segIdx];
    if (!seg) return;

    const nextCell = this.stateBuffer.getCell(seg.toX, seg.toY);
    if (nextCell && nextCell.occupiedBy && nextCell.occupiedBy !== ohtId) {
      state.waitCounter = Math.floor(Math.random() * 5 + 3);
      this.emitS6F11Report(
        ohtId,
        state.currentGridX,
        state.currentGridY,
        0,
        state.direction || 0,
        state.foupState,
        state.foupId,
      );
      return;
    }

    const step = (state.speed * 0.04) / 0.18;
    state.progress += step;

    if (state.progress >= 1.0) {
      state.progress = 0;
      state.prevGridX = state.currentGridX;
      state.prevGridY = state.currentGridY;
      state.currentGridX = seg.toX;
      state.currentGridY = seg.toY;

      this.stateBuffer.advanceOhtSegment(ohtId);

      const dx = seg.toX - seg.fromX;
      const dy = seg.toY - seg.fromY;
      let direction = 0;
      if (dx > 0) direction = 0;
      else if (dx < 0) direction = 180;
      else if (dy > 0) direction = 90;
      else if (dy < 0) direction = 270;
      state.direction = direction;

      if (seg.toX === state.targetGridX && seg.toY === state.targetGridY) {
        this.handleArrival(ohtId, state);
      }
    }

    const interpX = state.prevGridX + (state.currentGridX - state.prevGridX) * state.progress;
    const interpY = state.prevGridY + (state.currentGridY - state.prevGridY) * state.progress;
    const direction = this.calculateDirection(seg, state);

    this.emitS6F11Report(
      ohtId,
      interpX,
      interpY,
      state.speed,
      direction,
      state.foupState,
      state.foupId,
    );
  }

  private calculateDirection(seg: any, state: any): number {
    const dx = seg.toX - seg.fromX;
    const dy = seg.toY - seg.fromY;
    if (dx > 0 && dy === 0) return 0;
    if (dx < 0 && dy === 0) return 180;
    if (dx === 0 && dy > 0) return 90;
    if (dx === 0 && dy < 0) return 270;
    if (dx > 0 && dy > 0) return 45;
    if (dx > 0 && dy < 0) return 315;
    if (dx < 0 && dy > 0) return 135;
    if (dx < 0 && dy < 0) return 225;
    return state.direction || 0;
  }

  private handleArrival(ohtId: string, state: any) {
    const cell = this.stateBuffer.getCell(state.currentGridX, state.currentGridY);
    const isStation = cell?.type === 'STATION';

    if (isStation) {
      state.waitCounter = 40 + Math.floor(Math.random() * 40);

      if (state.foupState === FoupState.LOADED) {
        state.foupState = FoupState.PLACING;
        setTimeout(() => {
          state.foupState = FoupState.EMPTY;
          state.foupId = undefined;
          this.emitS6F11Report(ohtId, state.currentGridX, state.currentGridY, 0, state.direction || 0, state.foupState, undefined);
        }, 800);
      } else {
        state.foupState = FoupState.PICKING;
        const newFoupId = `F-${String(Math.floor(Math.random() * 9000 + 1000))}`;
        setTimeout(() => {
          state.foupState = FoupState.LOADED;
          state.foupId = newFoupId;
          this.emitS6F11Report(ohtId, state.currentGridX, state.currentGridY, 0, state.direction || 0, state.foupState, newFoupId);
        }, 800);
      }
    } else {
      state.waitCounter = 3 + Math.floor(Math.random() * 8);
    }

    setTimeout(() => {
      const target = this.pickRandomTarget(state.currentGridX, state.currentGridY);
      state.targetGridX = target.x;
      state.targetGridY = target.y;
      this.routingService.assignRoute(ohtId, target.x, target.y);
      this.logger.debug(`OHT ${ohtId} new target: (${target.x},${target.y})`);
    }, isStation ? 1500 : 200);
  }

  private emitS6F11Report(
    ohtId: string,
    gridX: number,
    gridY: number,
    speed: number,
    direction: number,
    foupState: FoupState,
    foupId?: string,
  ) {
    const report: S6F11EventReport = {
      ohtId,
      eventId: speed > 0.1 ? 'EVT_MOVING' : 'EVT_POS_REPORT',
      eventName: speed > 0.1 ? 'Moving' : 'PositionReport',
      currentPosition: { gridX, gridY },
      speed,
      direction,
      foupState,
      foupId,
      timestamp: Date.now(),
    };

    this.emit('s6f11-report', report);
    this.stateBuffer.processS6F11Report(report);
  }
}
