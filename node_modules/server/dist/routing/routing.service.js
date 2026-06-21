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
var RoutingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoutingService = void 0;
const common_1 = require("@nestjs/common");
const state_buffer_service_1 = require("../state-buffer/state-buffer.service");
class MinPriorityQueue {
    constructor() {
        this.heap = [];
    }
    push(item) {
        this.heap.push(item);
        this.bubbleUp(this.heap.length - 1);
    }
    pop() {
        if (this.heap.length === 0)
            return null;
        const top = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this.bubbleDown(0);
        }
        return top;
    }
    size() {
        return this.heap.length;
    }
    bubbleUp(index) {
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.heap[index].distance < this.heap[parent].distance) {
                [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
                index = parent;
            }
            else
                break;
        }
    }
    bubbleDown(index) {
        const length = this.heap.length;
        while (true) {
            let smallest = index;
            const left = 2 * index + 1;
            const right = 2 * index + 2;
            if (left < length && this.heap[left].distance < this.heap[smallest].distance)
                smallest = left;
            if (right < length && this.heap[right].distance < this.heap[smallest].distance)
                smallest = right;
            if (smallest !== index) {
                [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
                index = smallest;
            }
            else
                break;
        }
    }
}
let RoutingService = RoutingService_1 = class RoutingService {
    constructor(stateBuffer) {
        this.stateBuffer = stateBuffer;
        this.logger = new common_1.Logger(RoutingService_1.name);
        this.RESERVATION_LOOKAHEAD = 5;
        this.gridCols = 0;
        this.gridRows = 0;
        this.adjacencyCache = new Map();
        this.routingStats = {
            totalRequests: 0,
            successfulRoutes: 0,
            failedRoutes: 0,
            totalPathLength: 0,
            collisionAvoidances: 0,
        };
        this.ROUTING_INTERVAL_MS = parseInt(process.env.ROUTING_RECALCULATION_INTERVAL_MS || '100', 10);
    }
    onModuleInit() {
        const dims = this.stateBuffer.getGridDimensions();
        this.gridCols = dims.cols;
        this.gridRows = dims.rows;
        this.buildAdjacencyCache();
        this.logger.log(`Routing Engine initialized: ${this.gridCols}x${this.gridRows} nodes, interval=${this.ROUTING_INTERVAL_MS}ms`);
    }
    buildAdjacencyCache() {
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
    nodeKey(x, y) {
        return `${x},${y}`;
    }
    parseNodeKey(key) {
        const [x, y] = key.split(',').map(Number);
        return { x, y };
    }
    findShortestPath(startX, startY, endX, endY, ohtId, avoidCollisions = true) {
        this.routingStats.totalRequests++;
        const startTime = process.hrtime.bigint();
        if (startX === endX && startY === endY) {
            this.routingStats.successfulRoutes++;
            return [];
        }
        const distances = new Map();
        const previous = new Map();
        const visited = new Set();
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
            const current = pq.pop();
            const currentKey = current.node;
            if (visited.has(currentKey))
                continue;
            visited.add(currentKey);
            if (currentKey === endKey)
                break;
            const currentDist = distances.get(currentKey) ?? Infinity;
            if (current.distance > currentDist)
                continue;
            const { x: cx, y: cy } = this.parseNodeKey(currentKey);
            const neighbors = this.getNeighbors(cx, cy, ohtId, avoidCollisions);
            for (const neighbor of neighbors) {
                const nKey = this.nodeKey(neighbor.x, neighbor.y);
                if (visited.has(nKey))
                    continue;
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
            this.logger.debug(`Route for ${ohtId}: ${segments.length} segs, cost=${distances.get(endKey).toFixed(2)} (${elapsed.toFixed(2)}ms)`);
        }
        return segments;
    }
    getNeighbors(x, y, ohtId, avoidCollisions) {
        const base = this.adjacencyCache.get(this.nodeKey(x, y)) || [];
        if (!avoidCollisions)
            return base;
        return base.filter((n) => {
            const cell = this.stateBuffer.getCell(n.x, n.y);
            if (!cell)
                return false;
            if (cell.type === 'BLOCKED')
                return false;
            if (cell.occupiedBy && cell.occupiedBy !== ohtId)
                return false;
            if (cell.reservedBy && cell.reservedBy !== ohtId && (cell.reservedUntil || 0) > Date.now()) {
                return false;
            }
            return true;
        });
    }
    calculateDynamicWeight(fromX, fromY, neighbor, ohtId) {
        let weight = neighbor.weight;
        const cell = this.stateBuffer.getCell(neighbor.x, neighbor.y);
        if (!cell)
            return Infinity;
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
    countNearbyOhts(x, y, radius, excludeOhtId) {
        let count = 0;
        const ohts = this.stateBuffer.getAllOhts();
        for (const oht of ohts) {
            if (oht.id === excludeOhtId)
                continue;
            const dx = Math.abs(oht.gridX - x);
            const dy = Math.abs(oht.gridY - y);
            if (dx <= radius && dy <= radius)
                count++;
        }
        return count;
    }
    predictFutureConflict(x, y, ohtId) {
        const ohts = this.stateBuffer.getAllOhts();
        for (const oht of ohts) {
            if (oht.id === ohtId)
                continue;
            if (!oht.assignedRoute || oht.currentSegmentIndex === undefined)
                continue;
            const lookahead = Math.min(this.RESERVATION_LOOKAHEAD, oht.assignedRoute.length - oht.currentSegmentIndex);
            for (let i = oht.currentSegmentIndex; i < oht.currentSegmentIndex + lookahead; i++) {
                const seg = oht.assignedRoute[i];
                if (seg && seg.toX === x && seg.toY === y)
                    return true;
            }
        }
        return false;
    }
    reconstructPath(previous, startKey, endKey) {
        const path = [];
        let current = endKey;
        while (current !== null) {
            path.unshift(current);
            current = previous.get(current) ?? null;
        }
        if (path[0] !== startKey)
            return [];
        return path;
    }
    pathToSegments(path, distances) {
        const segments = [];
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
    recalculateAllRoutes() {
        const ohts = this.stateBuffer.getAllOhts();
        let updated = 0;
        for (const oht of ohts) {
            if (oht.targetGridX === undefined || oht.targetGridY === undefined)
                continue;
            if (oht.status === 'PARKING' || oht.status === 'BLOCKED')
                continue;
            const needsRecalc = this.needsRouteRecalculation(oht);
            if (!needsRecalc)
                continue;
            const newRoute = this.findShortestPath(oht.gridX, oht.gridY, oht.targetGridX, oht.targetGridY, oht.id, true);
            if (newRoute && newRoute.length > 0) {
                this.stateBuffer.setOhtRoute(oht.id, newRoute);
                this.stateBuffer.reservePath(oht.id, newRoute.slice(0, this.RESERVATION_LOOKAHEAD));
                updated++;
            }
        }
        return updated;
    }
    needsRouteRecalculation(oht) {
        if (!oht.assignedRoute || oht.assignedRoute.length === 0)
            return true;
        if (oht.status === 'BLOCKED')
            return true;
        const idx = oht.currentSegmentIndex || 0;
        if (idx >= oht.assignedRoute.length - 2)
            return true;
        const nextSeg = oht.assignedRoute[idx + 1];
        if (nextSeg) {
            const nextCell = this.stateBuffer.getCell(nextSeg.toX, nextSeg.toY);
            if (nextCell && nextCell.occupiedBy && nextCell.occupiedBy !== oht.id)
                return true;
            if (nextCell && nextCell.type === 'BLOCKED')
                return true;
        }
        return false;
    }
    assignRoute(ohtId, targetX, targetY) {
        const oht = this.stateBuffer.getOht(ohtId);
        if (!oht) {
            this.logger.warn(`assignRoute: OHT ${ohtId} not found`);
            return null;
        }
        const route = this.findShortestPath(oht.gridX, oht.gridY, targetX, targetY, ohtId, true);
        if (route && route.length > 0) {
            this.stateBuffer.setOhtRoute(ohtId, route);
            const reserved = this.stateBuffer.reservePath(ohtId, route.slice(0, this.RESERVATION_LOOKAHEAD));
            if (!reserved) {
                this.logger.warn(`Could not reserve path for ${ohtId}, retrying without reservations...`);
            }
        }
        return route;
    }
    getRoutingStats() {
        return {
            ...this.routingStats,
            successRate: this.routingStats.totalRequests > 0
                ? (this.routingStats.successfulRoutes / this.routingStats.totalRequests * 100).toFixed(2) + '%'
                : 'N/A',
            avgPathLength: this.routingStats.successfulRoutes > 0
                ? (this.routingStats.totalPathLength / this.routingStats.successfulRoutes).toFixed(2)
                : 'N/A',
        };
    }
    getReservationLookahead() {
        return this.RESERVATION_LOOKAHEAD;
    }
};
exports.RoutingService = RoutingService;
exports.RoutingService = RoutingService = RoutingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [state_buffer_service_1.StateBufferService])
], RoutingService);
//# sourceMappingURL=routing.service.js.map