import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StateBufferService } from '../state-buffer/state-buffer.service';
import { DistributedLockService } from '../redis/distributed-lock.service';
import { RouteSegment, GridCell, OhtStatus } from '../common/types';

interface PriorityQueueItem {
  node: string;
  distance: number;
}

class MinPriorityQueue {
  private heap: PriorityQueueItem[] = [];

  push(item: PriorityQueueItem) {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): PriorityQueueItem | null {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  size(): number {
    return this.heap.length;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.heap[index].distance < this.heap[parent].distance) {
        [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
        index = parent;
      } else break;
    }
  }

  private bubbleDown(index: number) {
    const length = this.heap.length;
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      if (left < length && this.heap[left].distance < this.heap[smallest].distance) smallest = left;
      if (right < length && this.heap[right].distance < this.heap[smallest].distance) smallest = right;
      if (smallest !== index) {
        [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
        index = smallest;
      } else break;
    }
  }
}

@Injectable()
export class RoutingService implements OnModuleInit {
  private readonly logger = new Logger(RoutingService.name);
  private readonly ROUTING_INTERVAL_MS: number;
  private readonly RESERVATION_LOOKAHEAD: number = 5;
  private gridCols: number = 0;
  private gridRows: number = 0;
  private adjacencyCache: Map<string, { x: number; y: number; weight: number }[]> = new Map();
  private routingStats = {
    totalRequests: 0,
    successfulRoutes: 0,
    failedRoutes: 0,
    totalPathLength: 0,
    collisionAvoidances: 0,
  };

  constructor(
    private readonly stateBuffer: StateBufferService,
    private readonly lockService: DistributedLockService,
  ) {
    this.ROUTING_INTERVAL_MS = parseInt(process.env.ROUTING_RECALCULATION_INTERVAL_MS || '100', 10);
  }

  onModuleInit() {
    const dims = this.stateBuffer.getGridDimensions();
    this.gridCols = dims.cols;
    this.gridRows = dims.rows;
    this.buildAdjacencyCache();
    this.logger.log(`Routing Engine initialized: ${this.gridCols}x${this.gridRows} nodes, interval=${this.ROUTING_INTERVAL_MS}ms`);
  }

  private buildAdjacencyCache() {
    const grid = this.stateBuffer.getGrid();
    for (let y = 0; y < this.gridRows; y++) {
      for (let x = 0; x < this.gridCols; x++) {
        const cell = grid[y][x];
        if (cell.type !== 'BLOCKED') {
          this.adjacencyCache.set(this.nodeKey(x, y), cell.connections);
        }
      }
    }
    this.logger.log(`Adjacency cache built: ${this.adjacencyCache.size} nodes`);
  }

  private nodeKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  private parseNodeKey(key: string): { x: number; y: number } {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  }

  findShortestPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    ohtId: string,
    avoidCollisions: boolean = true,
  ): RouteSegment[] | null {
    this.routingStats.totalRequests++;
    const startTime = process.hrtime.bigint();

    if (startX === endX && startY === endY) {
      this.routingStats.successfulRoutes++;
      return [];
    }

    const distances: Map<string, number> = new Map();
    const previous: Map<string, string | null> = new Map();
    const visited: Set<string> = new Set();
    const pq = new MinPriorityQueue();

    const startKey = this.nodeKey(startX, startY);
    const endKey = this.nodeKey(endX, endY);

    distances.set(startKey, 0);
    previous.set(startKey, null);
    pq.push({ node: startKey, distance: 0 });

    let iteration = 0;
    const maxIterations = this.gridCols * this.gridRows * 4;

    while (pq.size() > 0 && iteration < maxIterations) {
      iteration++;
      const current = pq.pop()!;
      const currentKey = current.node;

      if (visited.has(currentKey)) continue;
      visited.add(currentKey);

      if (currentKey === endKey) break;

      const currentDist = distances.get(currentKey) ?? Infinity;
      if (current.distance > currentDist) continue;

      const { x: cx, y: cy } = this.parseNodeKey(currentKey);
      const neighbors = this.getNeighbors(cx, cy, ohtId, avoidCollisions);

      for (const neighbor of neighbors) {
        const nKey = this.nodeKey(neighbor.x, neighbor.y);
        if (visited.has(nKey)) continue;

        const dynamicWeight = this.calculateDynamicWeight(cx, cy, neighbor, ohtId);
        const newDist = currentDist + dynamicWeight;
        const oldDist = distances.get(nKey) ?? Infinity;

        if (newDist < oldDist) {
          distances.set(nKey, newDist);
          previous.set(nKey, currentKey);
          pq.push({ node: nKey, distance: newDist });
        }
      }
    }

    if (!distances.has(endKey) || distances.get(endKey) === Infinity) {
      this.routingStats.failedRoutes++;
      this.logger.warn(`Route not found: OHT ${ohtId} (${startX},${startY})→(${endX},${endY})`);
      return null;
    }

    const path = this.reconstructPath(previous, startKey, endKey);
    const segments = this.pathToSegments(path, distances);

    this.routingStats.successfulRoutes++;
    this.routingStats.totalPathLength += segments.length;

    const elapsed = Number(process.hrtime.bigint() - startTime) / 1e6;
    if (segments.length > 0) {
      this.logger.debug(`Route for ${ohtId}: ${segments.length} segs, cost=${distances.get(endKey)!.toFixed(2)} (${elapsed.toFixed(2)}ms)`);
    }

    return segments;
  }

  private getNeighbors(x: number, y: number, ohtId: string, avoidCollisions: boolean): { x: number; y: number; weight: number }[] {
    const base = this.adjacencyCache.get(this.nodeKey(x, y)) || [];
    if (!avoidCollisions) return base;

    return base.filter((n) => {
      const cell = this.stateBuffer.getCell(n.x, n.y);
      if (!cell) return false;
      if (cell.type === 'BLOCKED') return false;
      if (cell.occupiedBy && cell.occupiedBy !== ohtId) return false;
      if (cell.reservedBy && cell.reservedBy !== ohtId && (cell.reservedUntil || 0) > Date.now()) {
        return false;
      }
      if (this.lockService['redis'].isReady()) {
        const lockInfo = this.checkRedisLockCached(n.x, n.y, ohtId);
        if (lockInfo && lockInfo.locked && lockInfo.owner !== ohtId) {
          return false;
        }
      }
      return true;
    });
  }

  private calculateDynamicWeight(
    fromX: number,
    fromY: number,
    neighbor: { x: number; y: number; weight: number },
    ohtId: string,
  ): number {
    let weight = neighbor.weight;
    const cell = this.stateBuffer.getCell(neighbor.x, neighbor.y);
    if (!cell) return Infinity;

    if (cell.type === 'INTERSECTION') {
      const nearbyOhts = this.countNearbyOhts(neighbor.x, neighbor.y, 2, ohtId);
      weight += nearbyOhts * 2.0;
      if (nearbyOhts > 1) {
        this.routingStats.collisionAvoidances++;
      }
    }

    if (cell.type === 'STATION') {
      weight += 1.5;
    }

    const futureConflict = this.predictFutureConflict(neighbor.x, neighbor.y, ohtId);
    if (futureConflict) {
      weight += 5.0;
      this.routingStats.collisionAvoidances++;
    }

    if (cell.reservedBy && cell.reservedBy !== ohtId) {
      weight += 10.0;
    }

    return weight;
  }

  private countNearbyOhts(x: number, y: number, radius: number, excludeOhtId: string): number {
    let count = 0;
    const ohts = this.stateBuffer.getAllOhts();
    for (const oht of ohts) {
      if (oht.id === excludeOhtId) continue;
      const dx = Math.abs(oht.gridX - x);
      const dy = Math.abs(oht.gridY - y);
      if (dx <= radius && dy <= radius) count++;
    }
    return count;
  }

  private predictFutureConflict(x: number, y: number, ohtId: string): boolean {
    const ohts = this.stateBuffer.getAllOhts();
    for (const oht of ohts) {
      if (oht.id === ohtId) continue;
      if (!oht.assignedRoute || oht.currentSegmentIndex === undefined) continue;

      const lookahead = Math.min(
        this.RESERVATION_LOOKAHEAD,
        oht.assignedRoute.length - oht.currentSegmentIndex,
      );

      for (let i = oht.currentSegmentIndex; i < oht.currentSegmentIndex + lookahead; i++) {
        const seg = oht.assignedRoute[i];
        if (seg && seg.toX === x && seg.toY === y) return true;
      }
    }
    return false;
  }

  private reconstructPath(previous: Map<string, string | null>, startKey: string, endKey: string): string[] {
    const path: string[] = [];
    let current: string | null = endKey;

    while (current !== null) {
      path.unshift(current);
      current = previous.get(current) ?? null;
    }

    if (path[0] !== startKey) return [];
    return path;
  }

  private pathToSegments(path: string[], distances: Map<string, number>): RouteSegment[] {
    const segments: RouteSegment[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const from = this.parseNodeKey(path[i]);
      const to = this.parseNodeKey(path[i + 1]);
      const fromDist = distances.get(path[i]) ?? 0;
      const toDist = distances.get(path[i + 1]) ?? 0;
      segments.push({
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        weight: toDist - fromDist,
      });
    }
    return segments;
  }

  recalculateAllRoutes(): number {
    const ohts = this.stateBuffer.getAllOhts();
    let updated = 0;

    for (const oht of ohts) {
      if (oht.targetGridX === undefined || oht.targetGridY === undefined) continue;
      if (oht.status === 'PARKING' || oht.status === 'BLOCKED') continue;

      const needsRecalc = this.needsRouteRecalculation(oht);
      if (!needsRecalc) continue;

      const newRoute = this.findShortestPath(
        oht.gridX,
        oht.gridY,
        oht.targetGridX,
        oht.targetGridY,
        oht.id,
        true,
      );

      if (newRoute && newRoute.length > 0) {
        this.stateBuffer.setOhtRoute(oht.id, newRoute);
        const lookahead = newRoute.slice(0, this.RESERVATION_LOOKAHEAD);
        this.reservePathAtomic(oht.id, lookahead, oht.assignedRoute || []);
        updated++;
      }
    }

    return updated;
  }

  private needsRouteRecalculation(oht: OhtStatus): boolean {
    if (!oht.assignedRoute || oht.assignedRoute.length === 0) return true;
    if (oht.status === 'BLOCKED') return true;

    const idx = oht.currentSegmentIndex || 0;
    if (idx >= oht.assignedRoute.length - 2) return true;

    const nextSeg = oht.assignedRoute[idx + 1];
    if (nextSeg) {
      const nextCell = this.stateBuffer.getCell(nextSeg.toX, nextSeg.toY);
      if (nextCell && nextCell.occupiedBy && nextCell.occupiedBy !== oht.id) return true;
      if (nextCell && nextCell.type === 'BLOCKED') return true;
    }

    return false;
  }

  async assignRoute(ohtId: string, targetX: number, targetY: number): Promise<RouteSegment[] | null> {
    const oht = this.stateBuffer.getOht(ohtId);
    if (!oht) {
      this.logger.warn(`assignRoute: OHT ${ohtId} not found`);
      return null;
    }

    const route = this.findShortestPath(oht.gridX, oht.gridY, targetX, targetY, ohtId, true);
    if (route && route.length > 0) {
      this.stateBuffer.setOhtRoute(ohtId, route);
      const lookahead = route.slice(0, this.RESERVATION_LOOKAHEAD);
      const reserved = await this.reservePathAtomic(ohtId, lookahead, oht.assignedRoute || []);
      if (!reserved.success) {
        this.logger.warn(`Could not reserve path for ${ohtId}: ${reserved.error}`);
      }
    }
    return route;
  }

  getRoutingStats() {
    const lockStats = this.lockService.getStats();
    return {
      ...this.routingStats,
      successRate: this.routingStats.totalRequests > 0
        ? (this.routingStats.successfulRoutes / this.routingStats.totalRequests * 100).toFixed(2) + '%'
        : 'N/A',
      avgPathLength: this.routingStats.successfulRoutes > 0
        ? (this.routingStats.totalPathLength / this.routingStats.successfulRoutes).toFixed(2)
        : 'N/A',
      distributedLock: lockStats,
    };
  }

  getReservationLookahead(): number {
    return this.RESERVATION_LOOKAHEAD;
  }

  private lockCache = new Map<string, { info: any; cachedAt: number }>();
  private readonly LOCK_CACHE_TTL_MS = 50;

  private checkRedisLockCached(x: number, y: number, ohtId: string): { locked: boolean; owner: string } | null {
    const cacheKey = `${x}:${y}`;
    const now = Date.now();
    const cached = this.lockCache.get(cacheKey);

    if (cached && now - cached.cachedAt < this.LOCK_CACHE_TTL_MS) {
      return cached.info;
    }

    this.lockService.getLockInfo(x, y)
      .then((info) => {
        this.lockCache.set(cacheKey, {
          info: info ? { locked: true, owner: info.owner } : { locked: false, owner: '' },
          cachedAt: now,
        });
      })
      .catch(() => {});

    return null;
  }

  private async reservePathAtomic(
    ohtId: string,
    newSegments: RouteSegment[],
    oldSegments: RouteSegment[],
  ): Promise<{ success: boolean; error?: string; lockedCells?: Array<{ x: number; y: number }> }> {
    this.stateBuffer.reservePath(ohtId, newSegments);

    if (!this.lockService['redis'].isReady()) {
      return { success: true, error: 'Redis unavailable, using in-memory only' };
    }

    if (oldSegments.length > 0) {
      const releaseLookahead = Math.min(this.RESERVATION_LOOKAHEAD, oldSegments.length);
      for (let i = 0; i < releaseLookahead; i++) {
        const seg = oldSegments[i];
        if (seg) {
          await this.lockService.releaseGridLock(seg.toX, seg.toY, ohtId).catch(() => {});
        }
      }
    }

    const result = await this.lockService.acquirePathLocks(
      newSegments.map((s) => ({ toX: s.toX, toY: s.toY })),
      ohtId,
      15000,
    );

    if (!result.success) {
      this.logger.warn(`Atomic path lock failed for ${ohtId}: ${result.error}`);
      await this.lockService.releasePathLocks(
        result.acquired.map((key) => {
          const parts = key.replace('grid:lock:', '').split(':');
          return { toX: parseInt(parts[0]), toY: parseInt(parts[1]) };
        }),
        ohtId,
      );
      return { success: false, error: result.error };
    }

    return {
      success: true,
      lockedCells: newSegments.map((s) => ({ x: s.toX, y: s.toY })),
    };
  }

  async releaseAllLocksForOht(ohtId: string): Promise<void> {
    const locks = this.lockService.getActiveLocks().filter((l) => l.owner === ohtId);
    for (const lock of locks) {
      const parts = lock.key.replace('grid:lock:', '').split(':');
      await this.lockService.releaseGridLock(parseInt(parts[0]), parseInt(parts[1]), ohtId).catch(() => {});
    }
  }
}
