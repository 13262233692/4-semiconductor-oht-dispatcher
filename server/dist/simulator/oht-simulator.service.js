"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OhtSimulatorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OhtSimulatorService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const state_buffer_service_1 = require("../state-buffer/state-buffer.service");
const routing_service_1 = require("../routing/routing.service");
const types_1 = require("../common/types");
const events_1 = require("events");
let OhtSimulatorService = OhtSimulatorService_1 = class OhtSimulatorService extends events_1.EventEmitter {
    constructor(stateBuffer, routingService) {
        super();
        this.stateBuffer = stateBuffer;
        this.routingService = routingService;
        this.logger = new common_1.Logger(OhtSimulatorService_1.name);
        this.ohtInternalStates = new Map();
        this.stationPositions = [];
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
    discoverStations() {
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
    initializeOhts() {
        for (let i = 0; i < this.OHT_COUNT; i++) {
            const ohtId = `OHT-${String(i + 1).padStart(4, '0')}`;
            let startX, startY;
            let attempts = 0;
            do {
                startX = Math.floor(Math.random() * this.GRID_COLS);
                startY = Math.floor(Math.random() * this.GRID_ROWS);
                attempts++;
            } while (attempts < 100 &&
                this.stateBuffer.getCell(startX, startY)?.type === 'BLOCKED');
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
                foupState: hasFoup ? types_1.FoupState.LOADED : types_1.FoupState.EMPTY,
                foupId: hasFoup ? `F-${String(Math.floor(Math.random() * 9000 + 1000))}` : undefined,
                waitCounter: 0,
                routeRefreshCounter: Math.floor(Math.random() * 50),
            });
            this.routingService.assignRoute(ohtId, target.x, target.y);
            this.emitS6F11Report(ohtId, startX, startY, this.ohtInternalStates.get(ohtId).speed, 0, hasFoup ? types_1.FoupState.LOADED : types_1.FoupState.EMPTY, hasFoup ? this.ohtInternalStates.get(ohtId).foupId : undefined);
        }
    }
    pickRandomTarget(fromX, fromY) {
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
        let tx, ty, attempts = 0;
        do {
            tx = Math.floor(Math.random() * this.GRID_COLS);
            ty = Math.floor(Math.random() * this.GRID_ROWS);
            attempts++;
        } while (attempts < 50 &&
            (this.stateBuffer.getCell(tx, ty)?.type === 'BLOCKED' ||
                (Math.abs(tx - fromX) + Math.abs(ty - fromY) < 5)));
        return { x: tx, y: ty };
    }
    simulateTick() {
        if (!this.ENABLED)
            return;
        this.ohtInternalStates.forEach((state, ohtId) => {
            this.processOhtMovement(ohtId, state);
        });
    }
    processOhtMovement(ohtId, state) {
        if (state.waitCounter > 0) {
            state.waitCounter--;
            this.emitS6F11Report(ohtId, state.currentGridX, state.currentGridY, 0, state.direction || 0, state.foupState, state.foupId);
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
        if (!seg)
            return;
        const nextCell = this.stateBuffer.getCell(seg.toX, seg.toY);
        if (nextCell && nextCell.occupiedBy && nextCell.occupiedBy !== ohtId) {
            state.waitCounter = Math.floor(Math.random() * 5 + 3);
            this.emitS6F11Report(ohtId, state.currentGridX, state.currentGridY, 0, state.direction || 0, state.foupState, state.foupId);
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
            if (dx > 0)
                direction = 0;
            else if (dx < 0)
                direction = 180;
            else if (dy > 0)
                direction = 90;
            else if (dy < 0)
                direction = 270;
            state.direction = direction;
            if (seg.toX === state.targetGridX && seg.toY === state.targetGridY) {
                this.handleArrival(ohtId, state);
            }
        }
        const interpX = state.prevGridX + (state.currentGridX - state.prevGridX) * state.progress;
        const interpY = state.prevGridY + (state.currentGridY - state.prevGridY) * state.progress;
        const direction = this.calculateDirection(seg, state);
        this.emitS6F11Report(ohtId, interpX, interpY, state.speed, direction, state.foupState, state.foupId);
    }
    calculateDirection(seg, state) {
        const dx = seg.toX - seg.fromX;
        const dy = seg.toY - seg.fromY;
        if (dx > 0 && dy === 0)
            return 0;
        if (dx < 0 && dy === 0)
            return 180;
        if (dx === 0 && dy > 0)
            return 90;
        if (dx === 0 && dy < 0)
            return 270;
        if (dx > 0 && dy > 0)
            return 45;
        if (dx > 0 && dy < 0)
            return 315;
        if (dx < 0 && dy > 0)
            return 135;
        if (dx < 0 && dy < 0)
            return 225;
        return state.direction || 0;
    }
    handleArrival(ohtId, state) {
        const cell = this.stateBuffer.getCell(state.currentGridX, state.currentGridY);
        const isStation = cell?.type === 'STATION';
        if (isStation) {
            state.waitCounter = 40 + Math.floor(Math.random() * 40);
            if (state.foupState === types_1.FoupState.LOADED) {
                state.foupState = types_1.FoupState.PLACING;
                setTimeout(() => {
                    state.foupState = types_1.FoupState.EMPTY;
                    state.foupId = undefined;
                    this.emitS6F11Report(ohtId, state.currentGridX, state.currentGridY, 0, state.direction || 0, state.foupState, undefined);
                }, 800);
            }
            else {
                state.foupState = types_1.FoupState.PICKING;
                const newFoupId = `F-${String(Math.floor(Math.random() * 9000 + 1000))}`;
                setTimeout(() => {
                    state.foupState = types_1.FoupState.LOADED;
                    state.foupId = newFoupId;
                    this.emitS6F11Report(ohtId, state.currentGridX, state.currentGridY, 0, state.direction || 0, state.foupState, newFoupId);
                }, 800);
            }
        }
        else {
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
    emitS6F11Report(ohtId, gridX, gridY, speed, direction, foupState, foupId) {
        const report = {
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
};
exports.OhtSimulatorService = OhtSimulatorService;
__decorate([
    (0, schedule_1.Interval)(40),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OhtSimulatorService.prototype, "simulateTick", null);
exports.OhtSimulatorService = OhtSimulatorService = OhtSimulatorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [state_buffer_service_1.StateBufferService,
        routing_service_1.RoutingService])
], OhtSimulatorService);
//# sourceMappingURL=oht-simulator.service.js.map