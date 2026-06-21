import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
export declare class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger;
    private client;
    private reconnectAttempts;
    private maxReconnectDelay;
    private isDestroying;
    private boundHandlers;
    constructor();
    onModuleInit(): void;
    onModuleDestroy(): void;
    private connect;
    private registerHandler;
    private handleConnect;
    private handleReady;
    private handleError;
    private handleClose;
    private handleReconnecting;
    private handleEnd;
    private cleanupConnection;
    getClient(): Redis | null;
    isReady(): boolean;
    ping(): Promise<string | null>;
    eval(script: string, keys: string[], args: (string | number)[]): Promise<any>;
}
