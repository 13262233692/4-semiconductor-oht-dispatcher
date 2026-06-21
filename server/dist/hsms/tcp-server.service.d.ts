import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
export declare class TcpServerService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
    private readonly logger;
    private server;
    private sockets;
    private readonly PORT;
    private readonly MAX_RECONNECT_DELAY;
    private isShuttingDown;
    constructor();
    onModuleInit(): void;
    onModuleDestroy(): void;
    private start;
    private stop;
    private handleConnection;
    private createDataHandler;
    private createCloseHandler;
    private createErrorHandler;
    private createTimeoutHandler;
    private removeAllSocketListeners;
    private cleanupSocketState;
    private cleanupAllSockets;
    private scheduleReconnect;
    private extractMessages;
    sendMessage(clientId: string, messageBuffer: Buffer): boolean;
    broadcast(messageBuffer: Buffer): void;
    getClientCount(): number;
    getActiveClientIds(): string[];
    getSocketStats(): {
        connected: number;
        destroyed: number;
        reconnecting: number;
    };
}
