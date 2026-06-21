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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var WebsocketGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsocketGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const common_1 = require("@nestjs/common");
const socket_io_1 = require("socket.io");
const schedule_1 = require("@nestjs/schedule");
const state_buffer_service_1 = require("../state-buffer/state-buffer.service");
const routing_service_1 = require("../routing/routing.service");
const hsms_service_1 = require("../hsms/hsms.service");
let WebsocketGateway = WebsocketGateway_1 = class WebsocketGateway {
    constructor(stateBuffer, routingService, hsmsService) {
        this.stateBuffer = stateBuffer;
        this.routingService = routingService;
        this.hsmsService = hsmsService;
        this.logger = new common_1.Logger(WebsocketGateway_1.name);
        this.sequenceCounter = 0;
        this.clientCount = 0;
        this.BROADCAST_INTERVAL = parseInt(process.env.BROADCAST_INTERVAL_MS || '50', 10);
    }
    afterInit(server) {
        this.logger.log(`WebSocket Gateway initialized (broadcast @ ${this.BROADCAST_INTERVAL}ms)`);
        this.hsmsService.on('s6f11-report', (report) => {
            const oht = this.stateBuffer.processS6F11Report(report);
            this.server.emit('oht:event', {
                type: 'S6F11',
                ohtId: oht.id,
                timestamp: Date.now(),
                data: report,
            });
        });
    }
    handleConnection(client) {
        this.clientCount++;
        this.logger.log(`WebSocket client connected: ${client.id} (total: ${this.clientCount})`);
        client.emit('system:init', this.buildInitialState());
    }
    handleDisconnect(client) {
        this.clientCount--;
        this.logger.log(`WebSocket client disconnected: ${client.id} (total: ${this.clientCount})`);
    }
    broadcastSpatioTemporalFrame() {
        if (this.clientCount === 0)
            return;
        const frame = this.buildSpatioTemporalFrame();
        this.server.emit('frame:update', frame);
    }
    triggerRoutingRecalculation() {
        try {
            this.stateBuffer.cleanupExpiredReservations();
            const updated = this.routingService.recalculateAllRoutes();
            if (updated > 0) {
                this.logger.debug(`Recalculated ${updated} OHT routes`);
            }
        }
        catch (e) {
            this.logger.warn(`Routing recalc error: ${e.message}`);
        }
    }
    broadcastSystemStatus() {
        const dims = this.stateBuffer.getGridDimensions();
        const metrics = this.stateBuffer.getGridMetrics();
        const routingStats = this.routingService.getRoutingStats();
        this.server.emit('system:status', {
            timestamp: Date.now(),
            activeConnections: this.hsmsService.getActiveConnections(),
            wsClients: this.clientCount,
            ohtCount: this.stateBuffer.getOhtCount(),
            grid: {
                cols: dims.cols,
                rows: dims.rows,
                cellSize: dims.cellSize,
                worldWidth: dims.cols * dims.cellSize,
                worldHeight: dims.rows * dims.cellSize,
            },
            metrics,
            routing: routingStats,
        });
    }
    async handleAssignRoute(data, client) {
        this.logger.log(`Route assignment request: ${data.ohtId} → (${data.targetX},${data.targetY})`);
        const route = await this.routingService.assignRoute(data.ohtId, data.targetX, data.targetY);
        client.emit('control:routeAssigned', {
            ohtId: data.ohtId,
            success: route !== null,
            route: route || [],
            timestamp: Date.now(),
        });
    }
    handleGetOhtList(client) {
        const ohts = this.stateBuffer.getAllOhts().map((o) => ({
            id: o.id,
            gridX: o.gridX,
            gridY: o.gridY,
            speed: o.speed,
            status: o.status,
            foupState: o.foupState,
            foupId: o.foupId,
            targetGridX: o.targetGridX,
            targetGridY: o.targetGridY,
            routeLength: o.assignedRoute?.length || 0,
            color: this.stateBuffer.getOhtColor(o.id),
        }));
        client.emit('control:ohtList', ohts);
    }
    handleGetGridMap(client) {
        const grid = this.stateBuffer.getGrid();
        const dims = this.stateBuffer.getGridDimensions();
        const cells = [];
        for (let y = 0; y < dims.rows; y++) {
            for (let x = 0; x < dims.cols; x++) {
                const cell = grid[y][x];
                if (cell.type !== 'TRACK' || cell.occupiedBy || cell.reservedBy) {
                    cells.push({
                        x: cell.x,
                        y: cell.y,
                        type: cell.type,
                        stationId: cell.stationId,
                        occupiedBy: cell.occupiedBy,
                        reservedBy: cell.reservedBy,
                    });
                }
            }
        }
        client.emit('control:gridMap', { cells, dims });
    }
    handleRequestSnapshot(client) {
        client.emit('frame:snapshot', this.buildSpatioTemporalFrame());
    }
    buildInitialState() {
        const dims = this.stateBuffer.getGridDimensions();
        const grid = this.stateBuffer.getGrid();
        const specialCells = [];
        const stations = [];
        for (let y = 0; y < dims.rows; y++) {
            for (let x = 0; x < dims.cols; x++) {
                const cell = grid[y][x];
                if (cell.type === 'STATION') {
                    stations.push({ x, y, stationId: cell.stationId });
                }
                if (cell.type === 'BLOCKED' || cell.type === 'BUFFER' || cell.type === 'INTERSECTION') {
                    specialCells.push({ x, y, type: cell.type });
                }
            }
        }
        return {
            timestamp: Date.now(),
            grid: {
                cols: dims.cols,
                rows: dims.rows,
                cellSize: dims.cellSize,
                worldWidth: dims.cols * dims.cellSize,
                worldHeight: dims.rows * dims.cellSize,
            },
            stations,
            specialCells,
            colors: this.stateBuffer.getColorPalette(),
            frame: this.buildSpatioTemporalFrame(),
        };
    }
    buildSpatioTemporalFrame() {
        this.sequenceCounter++;
        const ohts = this.stateBuffer.getAllOhts().map((oht) => ({
            id: oht.id,
            x: oht.worldX,
            y: oht.worldY,
            gridX: oht.gridX,
            gridY: oht.gridY,
            speed: oht.speed,
            direction: oht.direction,
            foupState: oht.foupState,
            foupId: oht.foupId,
            status: oht.status,
            color: this.stateBuffer.getOhtColor(oht.id),
        }));
        return {
            timestamp: Date.now(),
            sequence: this.sequenceCounter,
            ohts,
            gridMetrics: this.stateBuffer.getGridMetrics(),
        };
    }
};
exports.WebsocketGateway = WebsocketGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], WebsocketGateway.prototype, "server", void 0);
__decorate([
    (0, schedule_1.Interval)(50),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WebsocketGateway.prototype, "broadcastSpatioTemporalFrame", null);
__decorate([
    (0, schedule_1.Interval)(100),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WebsocketGateway.prototype, "triggerRoutingRecalculation", null);
__decorate([
    (0, schedule_1.Interval)(5000),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WebsocketGateway.prototype, "broadcastSystemStatus", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('control:assignRoute'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], WebsocketGateway.prototype, "handleAssignRoute", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('control:getOhtList'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket]),
    __metadata("design:returntype", void 0)
], WebsocketGateway.prototype, "handleGetOhtList", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('control:getGridMap'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket]),
    __metadata("design:returntype", void 0)
], WebsocketGateway.prototype, "handleGetGridMap", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('control:requestSnapshot'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket]),
    __metadata("design:returntype", void 0)
], WebsocketGateway.prototype, "handleRequestSnapshot", null);
exports.WebsocketGateway = WebsocketGateway = WebsocketGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: { origin: '*' },
        transports: ['websocket', 'polling'],
        pingInterval: 10000,
        pingTimeout: 5000,
    }),
    __metadata("design:paramtypes", [state_buffer_service_1.StateBufferService,
        routing_service_1.RoutingService,
        hsms_service_1.HsmsService])
], WebsocketGateway);
//# sourceMappingURL=websocket.gateway.js.map