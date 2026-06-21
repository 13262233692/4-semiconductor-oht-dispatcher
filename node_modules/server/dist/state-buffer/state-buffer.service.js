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
var StateBufferService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateBufferService = void 0;
const common_1 = require("@nestjs/common");
let StateBufferService = StateBufferService_1 = class StateBufferService {
    constructor() {
        this.logger = new common_1.Logger(StateBufferService_1.name);
        this.ohtMap = new Map();
        this.grid = [];
        this.ohtColors = [];
        this.GRID_COLS = parseInt(process.env.GRID_COLS || '40', 10);
        this.GRID_ROWS = parseInt(process.env.GRID_ROWS || '30', 10);
        this.CELL_SIZE = parseInt(process.env.GRID_CELL_SIZE || '50', 10);
        this.OHT_COUNT = parseInt(process.env.OHT_COUNT || '120', 10);
    }
    onModuleInit() {
        this.initializeGrid();
        this.initializeOhtColors();
        this.logger.log(`StateBuffer initialized: ${this.GRID_COLS}x${this.GRID_ROWS} grid, ${this.OHT_COUNT} OHTs capacity`);
    }
    initializeOhtColors() {
        const baseHues = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
        for (let i = 0; i < this.OHT_COUNT; i++) {
            const hue = baseHues[i % baseHues.length] + Math.floor(i / baseHues.length) * 7;
            const saturation = 70 + (i % 3) * 5;
            const lightness = 50 + (i % 2) * 5;
            this.ohtColors.push(`hsl(${hue % 360}, ${saturation}%, ${lightness}%)`);
        }
    }
    initializeGrid() {
        this.grid = [];
        for (let y = 0; y < this.GRID_ROWS; y++) {
            this.grid[y] = [];
            for (let x = 0; x < this.GRID_COLS; x++) {
                this.grid[y][x] = this.createGridCell(x, y);
            }
        }
        this.logger.log(`Grid initialized: ${this.GRID_COLS} cols x ${this.GRID_ROWS} rows`);
    }
    createGridCell(x, y) {
        const isIntersection = (x % 5 === 0) && (y % 5 === 0);
        const isStation = (x === 3 || x === 8 || x === 13 || x === 18 || x === 23 || x === 28 || x === 33 || x === 38)
            && (y === 3 || y === 8 || y === 13 || y === 18 || y === 23 || y === 28);
        const isBufferZone = (x >= 36 && x <= 39 && y >= 0 && y <= 4);
        let type = 'TRACK';
        let stationId;
        if (isIntersection)
            type = 'INTERSECTION';
        if (isStation) {
            type = 'STATION';
            stationId = `ST-${x}-${y}`;
        }
        if (isBufferZone)
            type = 'BUFFER';
        if (x === 15 && (y >= 10 && y <= 20))
            type = 'BLOCKED';
        if (y === 15 && (x >= 25 && x <= 30))
            type = 'BLOCKED';
        return {
            x, y, type, stationId,
            connections: this.calculateConnections(x, y, type),
        };
    }
    calculateConnections(x, y, type) {
        const connections = [];
        if (type === 'BLOCKED')
            return connections;
        const directions = [
            { dx: 0, dy: -1 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 },
            { dx: 1, dy: 0 },
        ];
        for (const { dx, dy } of directions) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < this.GRID_COLS && ny >= 0 && ny < this.GRID_ROWS) {
                let weight = 1.0;
                if (type === 'INTERSECTION')
                    weight *= 2.5;
                if (type === 'STATION')
                    weight *= 3.0;
                if (type === 'BUFFER')
                    weight *= 0.8;
                connections.push({ x: nx, y: ny, weight });
            }
        }
        return connections;
    }
    processS6F11Report(report) {
        let oht = this.ohtMap.get(report.ohtId);
        const now = Date.now();
        const gridX = Math.max(0, Math.min(this.GRID_COLS - 1, Math.round(report.currentPosition.gridX)));
        const gridY = Math.max(0, Math.min(this.GRID_ROWS - 1, Math.round(report.currentPosition.gridY)));
        const worldX = gridX * this.CELL_SIZE + this.CELL_SIZE / 2;
        const worldY = gridY * this.CELL_SIZE + this.CELL_SIZE / 2;
        if (!oht) {
            const colorIndex = this.ohtMap.size % this.ohtColors.length;
            oht = {
                id: report.ohtId,
                gridX, gridY, worldX, worldY,
                speed: report.speed,
                direction: report.direction,
                foupState: report.foupState,
                foupId: report.foupId,
                lastUpdate: now,
                status: 'IDLE',
            };
            this.ohtMap.set(report.ohtId, oht);
        }
        else {
            const prevGridX = oht.gridX;
            const prevGridY = oht.gridY;
            if (prevGridX !== gridX || prevGridY !== gridY) {
                this.releaseCellReservation(prevGridX, prevGridY, report.ohtId);
            }
            oht.gridX = gridX;
            oht.gridY = gridY;
            oht.worldX = worldX;
            oht.worldY = worldY;
            oht.speed = report.speed;
            oht.direction = report.direction;
            oht.foupState = report.foupState;
            oht.foupId = report.foupId;
            oht.lastUpdate = now;
            oht.status = report.speed > 0.1 ? 'MOVING' : 'IDLE';
        }
        this.occupyCell(gridX, gridY, report.ohtId, report.speed);
        return oht;
    }
    occupyCell(x, y, ohtId, speed) {
        if (this.grid[y] && this.grid[y][x]) {
            this.grid[y][x].occupiedBy = ohtId;
            if (speed < 0.2) {
                this.grid[y][x].reservedBy = ohtId;
                this.grid[y][x].reservedUntil = Date.now() + 5000;
            }
        }
    }
    releaseCellReservation(x, y, ohtId) {
        if (this.grid[y] && this.grid[y][x]) {
            const cell = this.grid[y][x];
            if (cell.occupiedBy === ohtId)
                cell.occupiedBy = undefined;
            if (cell.reservedBy === ohtId) {
                cell.reservedBy = undefined;
                cell.reservedUntil = undefined;
            }
        }
    }
    getOht(ohtId) {
        return this.ohtMap.get(ohtId);
    }
    getAllOhts() {
        return Array.from(this.ohtMap.values());
    }
    getOhtCount() {
        return this.ohtMap.size;
    }
    getGrid() {
        return this.grid;
    }
    getCell(x, y) {
        if (x < 0 || x >= this.GRID_COLS || y < 0 || y >= this.GRID_ROWS)
            return null;
        return this.grid[y][x];
    }
    getGridDimensions() {
        return { cols: this.GRID_COLS, rows: this.GRID_ROWS, cellSize: this.CELL_SIZE };
    }
    getOhtColor(ohtId) {
        const keys = Array.from(this.ohtMap.keys());
        const idx = keys.indexOf(ohtId);
        return idx >= 0 ? this.ohtColors[idx % this.ohtColors.length] : '#888888';
    }
    getColorPalette() {
        return this.ohtColors;
    }
    setOhtRoute(ohtId, route) {
        const oht = this.ohtMap.get(ohtId);
        if (oht) {
            oht.assignedRoute = route;
            oht.currentSegmentIndex = 0;
            if (route.length > 0) {
                const last = route[route.length - 1];
                oht.targetGridX = last.toX;
                oht.targetGridY = last.toY;
            }
        }
    }
    advanceOhtSegment(ohtId) {
        const oht = this.ohtMap.get(ohtId);
        if (!oht || !oht.assignedRoute)
            return false;
        if ((oht.currentSegmentIndex || 0) >= oht.assignedRoute.length - 1) {
            oht.status = 'IDLE';
            return false;
        }
        oht.currentSegmentIndex = (oht.currentSegmentIndex || 0) + 1;
        return true;
    }
    getGridMetrics() {
        let totalCells = 0, occupiedCells = 0, collisionWarnings = 0;
        for (let y = 0; y < this.GRID_ROWS; y++) {
            for (let x = 0; x < this.GRID_COLS; x++) {
                const cell = this.grid[y][x];
                totalCells++;
                if (cell.occupiedBy)
                    occupiedCells++;
                if (cell.type === 'INTERSECTION' && cell.occupiedBy)
                    collisionWarnings++;
            }
        }
        return { totalCells, occupiedCells, collisionWarnings };
    }
    reservePath(ohtId, segments, timeoutMs = 10000) {
        const until = Date.now() + timeoutMs;
        for (const seg of segments) {
            const cell = this.getCell(seg.toX, seg.toY);
            if (!cell || cell.type === 'BLOCKED')
                return false;
            if (cell.reservedBy && cell.reservedBy !== ohtId && (cell.reservedUntil || 0) > Date.now()) {
                return false;
            }
        }
        for (const seg of segments) {
            const cell = this.getCell(seg.toX, seg.toY);
            if (cell) {
                cell.reservedBy = ohtId;
                cell.reservedUntil = until;
            }
        }
        return true;
    }
    cleanupExpiredReservations() {
        const now = Date.now();
        let released = 0;
        for (let y = 0; y < this.GRID_ROWS; y++) {
            for (let x = 0; x < this.GRID_COLS; x++) {
                const cell = this.grid[y][x];
                if (cell.reservedUntil && cell.reservedUntil < now) {
                    cell.reservedBy = undefined;
                    cell.reservedUntil = undefined;
                    released++;
                }
            }
        }
        return released;
    }
};
exports.StateBufferService = StateBufferService;
exports.StateBufferService = StateBufferService = StateBufferService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], StateBufferService);
//# sourceMappingURL=state-buffer.service.js.map