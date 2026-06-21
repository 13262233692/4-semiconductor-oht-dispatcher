import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
export declare class TcpServerService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
    private readonly logger;
    private server;
    private clients;
    private readonly PORT;
    constructor();
    onModuleInit(): void;
    onModuleDestroy(): void;
    private start;
    private stop;
    private handleConnection;
    private extractMessages;
    sendMessage(clientId: string, messageBuffer: Buffer): boolean;
    broadcast(messageBuffer: Buffer): void;
    getClientCount(): number;
}
