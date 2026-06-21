import { OnModuleInit } from '@nestjs/common';
import { RedisService } from './redis.service';
export interface LockAcquireResult {
    success: boolean;
    lockId?: string;
    expiresAt?: number;
    error?: string;
}
export interface LockInfo {
    key: string;
    owner: string;
    acquiredAt: number;
    expiresAt: number;
    ttl: number;
}
export declare class DistributedLockService implements OnModuleInit {
    private readonly redis;
    private readonly logger;
    private readonly LOCK_KEY_PREFIX;
    private readonly DEFAULT_LOCK_TTL_MS;
    private readonly MAX_RETRY_ATTEMPTS;
    private readonly RETRY_DELAY_BASE_MS;
    private stats;
    private activeLocks;
    constructor(redis: RedisService);
    onModuleInit(): void;
    private getLockKey;
    acquireGridLock(gridX: number, gridY: number, ohtId: string, ttlMs?: number, force?: boolean, retryAttempts?: number): Promise<LockAcquireResult>;
    acquirePathLocks(segments: Array<{
        toX: number;
        toY: number;
    }>, ohtId: string, ttlMs?: number): Promise<{
        success: boolean;
        acquired: string[];
        error?: string;
    }>;
    releaseGridLock(gridX: number, gridY: number, ohtId: string): Promise<boolean>;
    releasePathLocks(segments: Array<{
        toX: number;
        toY: number;
    }>, ohtId: string): Promise<void>;
    renewGridLock(gridX: number, gridY: number, ohtId: string, ttlMs?: number): Promise<boolean>;
    getLockInfo(gridX: number, gridY: number): Promise<LockInfo | null>;
    forceClearLock(gridX: number, gridY: number): Promise<boolean>;
    scanAndClearZombieLocks(): Promise<void>;
    renewActiveLocks(): Promise<void>;
    private trackLock;
    private untrackLock;
    private updateLockExpiry;
    private sleep;
    getStats(): {
        activeLockCount: number;
        successRate: string;
        acquireAttempts: number;
        acquireSuccess: number;
        acquireFailed: number;
        acquireForceUsed: number;
        releaseSuccess: number;
        releaseFailed: number;
        zombiesDetected: number;
        zombiesCleared: number;
        renewals: number;
    };
    getActiveLocks(): Array<{
        key: string;
        owner: string;
        expiresInMs: number;
    }>;
}
