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
var DistributedLockService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DistributedLockService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const redis_service_1 = require("./redis.service");
const LUA_SCRIPTS = {
    ACQUIRE_LOCK: `
    local key = KEYS[1]
    local owner = ARGV[1]
    local ttl_ms = tonumber(ARGV[2])
    local force = tonumber(ARGV[3]) == 1
    local now = tonumber(ARGV[4])

    local current = redis.call('GET', key)
    local result = {}

    if current then
        local parts = {}
        for part in string.gmatch(current, '([^:]+)') do
            table.insert(parts, part)
        end

        local current_owner = parts[1]
        local current_expire = tonumber(parts[2])

        if current_owner == owner then
            local new_expire = now + ttl_ms
            redis.call('SET', key, owner .. ':' .. new_expire, 'PX', ttl_ms)
            result[1] = 'OK'
            result[2] = new_expire
            return result
        end

        if current_expire and current_expire <= now then
            redis.call('DEL', key)
        elseif not force then
            result[1] = 'FAILED'
            result[2] = current_owner
            result[3] = current_expire
            return result
        end
    end

    local expires_at = now + ttl_ms
    local ok = redis.call('SET', key, owner .. ':' .. expires_at, 'NX', 'PX', ttl_ms)

    if ok then
        result[1] = 'OK'
        result[2] = expires_at
    else
        local holder = redis.call('GET', key)
        local holder_owner = 'unknown'
        local holder_expire = 0
        if holder then
            local parts = {}
            for part in string.gmatch(holder, '([^:]+)') do
                table.insert(parts, part)
            end
            holder_owner = parts[1]
            holder_expire = tonumber(parts[2]) or 0
        end
        result[1] = 'FAILED'
        result[2] = holder_owner
        result[3] = holder_expire
    end

    return result
  `,
    RELEASE_LOCK: `
    local key = KEYS[1]
    local owner = ARGV[1]

    local current = redis.call('GET', key)
    if not current then
        return 0
    end

    local parts = {}
    for part in string.gmatch(current, '([^:]+)') do
        table.insert(parts, part)
    end

    local current_owner = parts[1]
    if current_owner == owner then
        redis.call('DEL', key)
        return 1
    end

    return 0
  `,
    RENEW_LOCK: `
    local key = KEYS[1]
    local owner = ARGV[1]
    local ttl_ms = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])

    local current = redis.call('GET', key)
    if not current then
        return 0
    end

    local parts = {}
    for part in string.gmatch(current, '([^:]+)') do
        table.insert(parts, part)
    end

    local current_owner = parts[1]
    if current_owner == owner then
        local new_expire = now + ttl_ms
        redis.call('SET', key, owner .. ':' .. new_expire, 'PX', ttl_ms)
        return 1
    end

    return 0
  `,
    FORCE_CLEAR_LOCK: `
    local key = KEYS[1]
    return redis.call('DEL', key)
  `,
    GET_LOCK_INFO: `
    local key = KEYS[1]
    local current = redis.call('GET', key)
    if not current then
        return nil
    end

    local ttl = redis.call('PTTL', key)
    local result = {current, tostring(ttl)}
    return result
  `,
    SCAN_ZOMBIE_LOCKS: `
    local cursor = ARGV[1]
    local prefix = ARGV[2]
    local now = tonumber(ARGV[3])
    local limit = tonumber(ARGV[4])

    local scan_result = redis.call('SCAN', cursor, 'MATCH', prefix .. '*', 'COUNT', limit)
    local next_cursor = scan_result[1]
    local keys = scan_result[2]

    local zombies = {}

    for _, key in ipairs(keys) do
        local val = redis.call('GET', key)
        if val then
            local parts = {}
            for part in string.gmatch(val, '([^:]+)') do
                table.insert(parts, part)
            end
            local expire = tonumber(parts[2])
            if expire and expire <= now then
                table.insert(zombies, key)
                table.insert(zombies, val)
            end
        end
    end

    table.insert(zombies, 1, next_cursor)
    return zombies
  `,
};
let DistributedLockService = DistributedLockService_1 = class DistributedLockService {
    constructor(redis) {
        this.redis = redis;
        this.logger = new common_1.Logger(DistributedLockService_1.name);
        this.LOCK_KEY_PREFIX = 'grid:lock:';
        this.DEFAULT_LOCK_TTL_MS = 15000;
        this.MAX_RETRY_ATTEMPTS = 10;
        this.RETRY_DELAY_BASE_MS = 20;
        this.stats = {
            acquireAttempts: 0,
            acquireSuccess: 0,
            acquireFailed: 0,
            acquireForceUsed: 0,
            releaseSuccess: 0,
            releaseFailed: 0,
            zombiesDetected: 0,
            zombiesCleared: 0,
            renewals: 0,
        };
        this.activeLocks = new Map();
    }
    onModuleInit() {
        this.logger.log('Distributed Lock Service initialized with atomic Lua scripts');
    }
    getLockKey(gridX, gridY) {
        return `${this.LOCK_KEY_PREFIX}${gridX}:${gridY}`;
    }
    async acquireGridLock(gridX, gridY, ohtId, ttlMs = this.DEFAULT_LOCK_TTL_MS, force = false, retryAttempts = this.MAX_RETRY_ATTEMPTS) {
        const key = this.getLockKey(gridX, gridY);
        this.stats.acquireAttempts++;
        for (let attempt = 0; attempt <= retryAttempts; attempt++) {
            try {
                const now = Date.now();
                const result = await this.redis.eval(LUA_SCRIPTS.ACQUIRE_LOCK, [key], [ohtId, ttlMs, force ? 1 : 0, now]);
                if (!result || result.length === 0) {
                    return { success: false, error: 'Redis script returned empty result' };
                }
                const status = result[0];
                if (status === 'OK') {
                    this.stats.acquireSuccess++;
                    const expiresAt = Number(result[1]);
                    this.trackLock(key, ohtId, expiresAt, ttlMs);
                    if (force) {
                        this.stats.acquireForceUsed++;
                        this.logger.warn(`Force-acquired lock ${key} by ${ohtId}`);
                    }
                    return {
                        success: true,
                        lockId: key,
                        expiresAt,
                    };
                }
                else if (status === 'FAILED') {
                    const holder = result[1];
                    const holderExpire = Number(result[2]);
                    if (attempt < retryAttempts) {
                        const delay = this.RETRY_DELAY_BASE_MS * Math.pow(1.5, attempt) + Math.random() * 10;
                        await this.sleep(delay);
                        continue;
                    }
                    this.stats.acquireFailed++;
                    return {
                        success: false,
                        error: `Lock held by ${holder}, expires at ${new Date(holderExpire).toISOString()}`,
                    };
                }
            }
            catch (error) {
                this.logger.error(`Lock acquire error (${key}, attempt ${attempt}): ${error.message}`);
                if (attempt < retryAttempts) {
                    await this.sleep(this.RETRY_DELAY_BASE_MS * Math.pow(2, attempt));
                    continue;
                }
                this.stats.acquireFailed++;
                return { success: false, error: error.message };
            }
        }
        this.stats.acquireFailed++;
        return { success: false, error: 'Max retry attempts exceeded' };
    }
    async acquirePathLocks(segments, ohtId, ttlMs = this.DEFAULT_LOCK_TTL_MS) {
        const acquired = [];
        for (const seg of segments) {
            const result = await this.acquireGridLock(seg.toX, seg.toY, ohtId, ttlMs, false, 3);
            if (!result.success) {
                for (const key of acquired) {
                    const parts = key.replace(this.LOCK_KEY_PREFIX, '').split(':');
                    await this.releaseGridLock(parseInt(parts[0]), parseInt(parts[1]), ohtId).catch(() => { });
                }
                return { success: false, acquired: [], error: result.error || `Failed to lock (${seg.toX},${seg.toY})` };
            }
            acquired.push(result.lockId);
        }
        return { success: true, acquired };
    }
    async releaseGridLock(gridX, gridY, ohtId) {
        const key = this.getLockKey(gridX, gridY);
        try {
            const result = await this.redis.eval(LUA_SCRIPTS.RELEASE_LOCK, [key], [ohtId]);
            this.untrackLock(key);
            if (result === 1) {
                this.stats.releaseSuccess++;
                return true;
            }
            this.stats.releaseFailed++;
            this.logger.warn(`Lock release failed: ${key} not owned by ${ohtId}`);
            return false;
        }
        catch (error) {
            this.logger.error(`Lock release error (${key}): ${error.message}`);
            this.stats.releaseFailed++;
            return false;
        }
    }
    async releasePathLocks(segments, ohtId) {
        for (const seg of segments) {
            await this.releaseGridLock(seg.toX, seg.toY, ohtId).catch(() => { });
        }
    }
    async renewGridLock(gridX, gridY, ohtId, ttlMs = this.DEFAULT_LOCK_TTL_MS) {
        const key = this.getLockKey(gridX, gridY);
        try {
            const now = Date.now();
            const result = await this.redis.eval(LUA_SCRIPTS.RENEW_LOCK, [key], [ohtId, ttlMs, now]);
            if (result === 1) {
                this.stats.renewals++;
                this.updateLockExpiry(key, now + ttlMs, ttlMs);
                return true;
            }
            return false;
        }
        catch (error) {
            this.logger.error(`Lock renew error (${key}): ${error.message}`);
            return false;
        }
    }
    async getLockInfo(gridX, gridY) {
        const key = this.getLockKey(gridX, gridY);
        try {
            const result = await this.redis.eval(LUA_SCRIPTS.GET_LOCK_INFO, [key], []);
            if (!result || result.length < 2)
                return null;
            const value = result[0];
            const ttl = Number(result[1]);
            const parts = value.split(':');
            const owner = parts[0];
            const expiresAt = Number(parts[1]);
            return {
                key,
                owner,
                acquiredAt: expiresAt - this.DEFAULT_LOCK_TTL_MS,
                expiresAt,
                ttl,
            };
        }
        catch (error) {
            this.logger.error(`Get lock info error (${key}): ${error.message}`);
            return null;
        }
    }
    async forceClearLock(gridX, gridY) {
        const key = this.getLockKey(gridX, gridY);
        try {
            const result = await this.redis.eval(LUA_SCRIPTS.FORCE_CLEAR_LOCK, [key], []);
            this.untrackLock(key);
            if (result === 1) {
                this.logger.warn(`Force-cleared lock: ${key}`);
                return true;
            }
            return false;
        }
        catch (error) {
            this.logger.error(`Force clear lock error (${key}): ${error.message}`);
            return false;
        }
    }
    async scanAndClearZombieLocks() {
        if (!this.redis.isReady())
            return;
        try {
            const now = Date.now();
            let cursor = '0';
            const limit = 100;
            let totalCleared = 0;
            let totalDetected = 0;
            do {
                const result = await this.redis.eval(LUA_SCRIPTS.SCAN_ZOMBIE_LOCKS, [], [cursor, this.LOCK_KEY_PREFIX, now, limit]);
                if (!result || result.length === 0)
                    break;
                cursor = result[0];
                const entries = result.slice(1);
                for (let i = 0; i < entries.length; i += 2) {
                    const key = entries[i];
                    const value = entries[i + 1];
                    totalDetected++;
                    try {
                        await this.redis.eval(LUA_SCRIPTS.FORCE_CLEAR_LOCK, [key], []);
                        this.untrackLock(key);
                        totalCleared++;
                        const parts = value.split(':');
                        this.logger.warn(`Cleared zombie lock ${key} (owner=${parts[0]}, expired=${new Date(Number(parts[1])).toISOString()})`);
                    }
                    catch (e) {
                        this.logger.warn(`Failed to clear zombie ${key}: ${e.message}`);
                    }
                }
            } while (cursor !== '0');
            if (totalDetected > 0) {
                this.stats.zombiesDetected += totalDetected;
                this.stats.zombiesCleared += totalCleared;
                this.logger.log(`Zombie lock scan: detected=${totalDetected}, cleared=${totalCleared}`);
            }
        }
        catch (error) {
            this.logger.error(`Zombie lock scan failed: ${error.message}`);
        }
    }
    async renewActiveLocks() {
        if (!this.redis.isReady())
            return;
        const now = Date.now();
        const renewalThreshold = this.DEFAULT_LOCK_TTL_MS * 0.6;
        for (const [key, info] of this.activeLocks) {
            if (info.expiresAt - now < renewalThreshold) {
                const parts = key.replace(this.LOCK_KEY_PREFIX, '').split(':');
                const gx = parseInt(parts[0]);
                const gy = parseInt(parts[1]);
                const renewed = await this.renewGridLock(gx, gy, info.owner, info.ttl);
                if (!renewed) {
                    this.logger.warn(`Failed to renew lock ${key} for ${info.owner}`);
                    this.untrackLock(key);
                }
            }
        }
    }
    trackLock(key, owner, expiresAt, ttl) {
        const existing = this.activeLocks.get(key);
        if (existing?.timer) {
            clearTimeout(existing.timer);
        }
        this.activeLocks.set(key, { key, owner, expiresAt, ttl });
    }
    untrackLock(key) {
        const existing = this.activeLocks.get(key);
        if (existing?.timer) {
            clearTimeout(existing.timer);
        }
        this.activeLocks.delete(key);
    }
    updateLockExpiry(key, expiresAt, ttl) {
        const info = this.activeLocks.get(key);
        if (info) {
            info.expiresAt = expiresAt;
            info.ttl = ttl;
        }
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    getStats() {
        return {
            ...this.stats,
            activeLockCount: this.activeLocks.size,
            successRate: this.stats.acquireAttempts > 0
                ? ((this.stats.acquireSuccess / this.stats.acquireAttempts) * 100).toFixed(2) + '%'
                : 'N/A',
        };
    }
    getActiveLocks() {
        const now = Date.now();
        return Array.from(this.activeLocks.values()).map((info) => ({
            key: info.key,
            owner: info.owner,
            expiresInMs: Math.max(0, info.expiresAt - now),
        }));
    }
};
exports.DistributedLockService = DistributedLockService;
__decorate([
    (0, schedule_1.Interval)(5000),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DistributedLockService.prototype, "scanAndClearZombieLocks", null);
__decorate([
    (0, schedule_1.Interval)(3000),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DistributedLockService.prototype, "renewActiveLocks", null);
exports.DistributedLockService = DistributedLockService = DistributedLockService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_service_1.RedisService])
], DistributedLockService);
//# sourceMappingURL=distributed-lock.service.js.map