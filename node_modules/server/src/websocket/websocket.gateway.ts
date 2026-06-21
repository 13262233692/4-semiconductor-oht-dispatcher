import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Cron, Interval } from '@nestjs/schedule';
import { StateBufferService } from '../state-buffer/state-buffer.service';
import { RoutingService } from '../routing/routing.service';
import { HsmsService } from '../hsms/hsms.service';
import { SpatioTemporalFrame, FoupState, S6F11EventReport } from '../common/types';

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingInterval: 10000,
  pingTimeout: 5000,
})
export class WebsocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(WebsocketGateway.name);
  private sequenceCounter: number = 0;
  private readonly BROADCAST_INTERVAL: number;
  private clientCount: number = 0;

  constructor(
    private readonly stateBuffer: StateBufferService,
    private readonly routingService: RoutingService,
    private readonly hsmsService: HsmsService,
  ) {
    this.BROADCAST_INTERVAL = parseInt(process.env.BROADCAST_INTERVAL_MS || '50', 10);
  }

  afterInit(server: Server) {
    this.logger.log(`WebSocket Gateway initialized (broadcast @ ${this.BROADCAST_INTERVAL}ms)`);

    this.hsmsService.on('s6f11-report', (report: S6F11EventReport) => {
      const oht = this.stateBuffer.processS6F11Report(report);
      this.server.emit('oht:event', {
        type: 'S6F11',
        ohtId: oht.id,
        timestamp: Date.now(),
        data: report,
      });
    });
  }

  handleConnection(client: Socket) {
    this.clientCount++;
    this.logger.log(`WebSocket client connected: ${client.id} (total: ${this.clientCount})`);
    client.emit('system:init', this.buildInitialState());
  }

  handleDisconnect(client: Socket) {
    this.clientCount--;
    this.logger.log(`WebSocket client disconnected: ${client.id} (total: ${this.clientCount})`);
  }

  @Interval(50)
  broadcastSpatioTemporalFrame() {
    if (this.clientCount === 0) return;
    const frame = this.buildSpatioTemporalFrame();
    this.server.emit('frame:update', frame);
  }

  @Interval(100)
  triggerRoutingRecalculation() {
    try {
      this.stateBuffer.cleanupExpiredReservations();
      const updated = this.routingService.recalculateAllRoutes();
      if (updated > 0) {
        this.logger.debug(`Recalculated ${updated} OHT routes`);
      }
    } catch (e) {
      this.logger.warn(`Routing recalc error: ${e.message}`);
    }
  }

  @Interval(5000)
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

  @SubscribeMessage('control:assignRoute')
  async handleAssignRoute(
    @MessageBody() data: { ohtId: string; targetX: number; targetY: number },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(`Route assignment request: ${data.ohtId} → (${data.targetX},${data.targetY})`);
    const route = await this.routingService.assignRoute(data.ohtId, data.targetX, data.targetY);
    client.emit('control:routeAssigned', {
      ohtId: data.ohtId,
      success: route !== null,
      route: route || [],
      timestamp: Date.now(),
    });
  }

  @SubscribeMessage('control:getOhtList')
  handleGetOhtList(@ConnectedSocket() client: Socket) {
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

  @SubscribeMessage('control:getGridMap')
  handleGetGridMap(@ConnectedSocket() client: Socket) {
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

  @SubscribeMessage('control:requestSnapshot')
  handleRequestSnapshot(@ConnectedSocket() client: Socket) {
    client.emit('frame:snapshot', this.buildSpatioTemporalFrame());
  }

  private buildInitialState(): any {
    const dims = this.stateBuffer.getGridDimensions();
    const grid = this.stateBuffer.getGrid();
    const specialCells: any[] = [];
    const stations: any[] = [];

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

  private buildSpatioTemporalFrame(): SpatioTemporalFrame {
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
}
