import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 5000;
  private isDestroying = false;

  private boundHandlers: Map<string, (...args: any[]) => void> = new Map();

  constructor() {}

  onModuleInit() {
    this.connect();
  }

  onModuleDestroy() {
    this.isDestroying = true;
    this.cleanupConnection();
  }

  private connect() {
    const options: RedisOptions = {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      keyPrefix: process.env.REDIS_PREFIX || 'oht:',
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
      lazyConnect: false,
      autoResubscribe: true,
      autoResendUnfulfilledCommands: true,
      showFriendlyErrorStack: process.env.NODE_ENV !== 'production',
      connectionName: 'oht-dispatcher',
      keepAlive: 30000,
      reconnectOnError: (err) => {
        this.logger.warn(`Redis reconnectOnError: ${err.message}`);
        return 1;
      },
      retryStrategy: (times) => {
        if (this.isDestroying) return null;
        this.reconnectAttempts = times;
        const delay = Math.min(times * 100, this.maxReconnectDelay);
        this.logger.warn(`Redis connection retry #${times}, next in ${delay}ms`);
        return delay;
      },
    };

    this.cleanupConnection();

    this.logger.log(`Connecting to Redis: ${options.host}:${options.port} (db=${options.db})`);
    this.client = new Redis(options);

    this.registerHandler('connect', this.handleConnect);
    this.registerHandler('ready', this.handleReady);
    this.registerHandler('error', this.handleError);
    this.registerHandler('close', this.handleClose);
    this.registerHandler('reconnecting', this.handleReconnecting);
    this.registerHandler('end', this.handleEnd);
  }

  private registerHandler(event: string, handler: (...args: any[]) => void) {
    if (!this.client) return;

    const bound = handler.bind(this);
    this.boundHandlers.set(event, bound);
    this.client.on(event, bound);
  }

  private handleConnect() {
    this.logger.log('Redis client connected');
  }

  private handleReady() {
    this.logger.log('Redis client ready');
    this.reconnectAttempts = 0;
  }

  private handleError(err: Error) {
    this.logger.error(`Redis error: ${err.message}`);
  }

  private handleClose() {
    if (!this.isDestroying) {
      this.logger.warn('Redis connection closed');
    }
  }

  private handleReconnecting() {
    this.logger.warn(`Redis reconnecting... (attempt #${this.reconnectAttempts + 1})`);
  }

  private handleEnd() {
    if (!this.isDestroying) {
      this.logger.warn('Redis connection ended');
    }
  }

  private cleanupConnection() {
    if (this.client) {
      this.boundHandlers.forEach((handler, event) => {
        this.client?.removeListener(event, handler);
      });
      this.boundHandlers.clear();

      try {
        this.client.disconnect(false);
      } catch (e) {
        this.logger.warn(`Error during Redis disconnect: ${e.message}`);
      }

      this.client = null;
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  isReady(): boolean {
    return this.client?.status === 'ready';
  }

  async ping(): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.ping();
    } catch (e) {
      this.logger.warn(`Redis ping failed: ${e.message}`);
      return null;
    }
  }

  async eval(script: string, keys: string[], args: (string | number)[]): Promise<any> {
    if (!this.client) {
      throw new Error('Redis client not available');
    }
    return this.client.eval(script, keys.length, ...keys, ...args);
  }
}
