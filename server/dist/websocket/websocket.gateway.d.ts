import { OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { StateBufferService } from '../state-buffer/state-buffer.service';
import { RoutingService } from '../routing/routing.service';
import { HsmsService } from '../hsms/hsms.service';
export declare class WebsocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    private readonly stateBuffer;
    private readonly routingService;
    private readonly hsmsService;
    server: Server;
    private readonly logger;
    private sequenceCounter;
    private readonly BROADCAST_INTERVAL;
    private clientCount;
    constructor(stateBuffer: StateBufferService, routingService: RoutingService, hsmsService: HsmsService);
    afterInit(server: Server): void;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): void;
    broadcastSpatioTemporalFrame(): void;
    triggerRoutingRecalculation(): void;
    broadcastSystemStatus(): void;
    handleAssignRoute(data: {
        ohtId: string;
        targetX: number;
        targetY: number;
    }, client: Socket): Promise<void>;
    handleGetOhtList(client: Socket): void;
    handleGetGridMap(client: Socket): void;
    handleRequestSnapshot(client: Socket): void;
    private buildInitialState;
    private buildSpatioTemporalFrame;
}
