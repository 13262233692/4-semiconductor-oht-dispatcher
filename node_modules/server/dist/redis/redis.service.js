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
var RedisService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = require("ioredis");
let RedisService = RedisService_1 = class RedisService {
    constructor() {
        this.logger = new common_1.Logger(RedisService_1.name);
        this.client = null;
        this.reconnectAttempts = 0;
        this.maxReconnectDelay = 5000;
        this.isDestroying = false;
        this.boundHandlers = new Map();
    }
    onModuleInit() {
        this.connect();
    }
    onModuleDestroy() {
        this.isDestroying = true;
        this.cleanupConnection();
    }
    connect() {
        const options = {
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
                if (this.isDestroying)
                    return null;
                this.reconnectAttempts = times;
                const delay = Math.min(times * 100, this.maxReconnectDelay);
                this.logger.warn(`Redis connection retry #${times}, next in ${delay}ms`);
                return delay;
            },
        };
        this.cleanupConnection();
        this.logger.log(`Connecting to Redis: ${options.host}:${options.port} (db=${options.db})`);
        this.client = new ioredis_1.default(options);
        this.registerHandler('connect', this.handleConnect);
        this.registerHandler('ready', this.handleReady);
        this.registerHandler('error', this.handleError);
        this.registerHandler('close', this.handleClose);
        this.registerHandler('reconnecting', this.handleReconnecting);
        this.registerHandler('end', this.handleEnd);
    }
    registerHandler(event, handler) {
        if (!this.client)
            return;
        const bound = handler.bind(this);
        this.boundHandlers.set(event, bound);
        this.client.on(event, bound);
    }
    handleConnect() {
        this.logger.log('Redis client connected');
    }
    handleReady() {
        this.logger.log('Redis client ready');
        this.reconnectAttempts = 0;
    }
    handleError(err) {
        this.logger.error(`Redis error: ${err.message}`);
    }
    handleClose() {
        if (!this.isDestroying) {
            this.logger.warn('Redis connection closed');
        }
    }
    handleReconnecting() {
        this.logger.warn(`Redis reconnecting... (attempt #${this.reconnectAttempts + 1})`);
    }
    handleEnd() {
        if (!this.isDestroying) {
            this.logger.warn('Redis connection ended');
        }
    }
    cleanupConnection() {
        if (this.client) {
            this.boundHandlers.forEach((handler, event) => {
                this.client?.removeListener(event, handler);
            });
            this.boundHandlers.clear();
            try {
                this.client.disconnect(false);
            }
            catch (e) {
                this.logger.warn(`Error during Redis disconnect: ${e.message}`);
            }
            this.client = null;
        }
    }
    getClient() {
        return this.client;
    }
    isReady() {
        return this.client?.status === 'ready';
    }
    async ping() {
        if (!this.client)
            return null;
        try {
            return await this.client.ping();
        }
        catch (e) {
            this.logger.warn(`Redis ping failed: ${e.message}`);
            return null;
        }
    }
    async eval(script, keys, args) {
        if (!this.client) {
            throw new Error('Redis client not available');
        }
        return this.client.eval(script, keys.length, ...keys, ...args);
    }
};
exports.RedisService = RedisService;
exports.RedisService = RedisService = RedisService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], RedisService);
//# sourceMappingURL=redis.service.js.map