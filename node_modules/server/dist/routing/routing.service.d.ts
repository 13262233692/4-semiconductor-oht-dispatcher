import { OnModuleInit } from '@nestjs/common';
import { StateBufferService } from '../state-buffer/state-buffer.service';
import { RouteSegment } from '../common/types';
export declare class RoutingService implements OnModuleInit {
    private readonly stateBuffer;
    private readonly logger;
    private readonly ROUTING_INTERVAL_MS;
    private readonly RESERVATION_LOOKAHEAD;
    private gridCols;
    private gridRows;
    private adjacencyCache;
    private routingStats;
    constructor(stateBuffer: StateBufferService);
    onModuleInit(): void;
    private buildAdjacencyCache;
    private nodeKey;
    private parseNodeKey;
    findShortestPath(startX: number, startY: number, endX: number, endY: number, ohtId: string, avoidCollisions?: boolean): RouteSegment[] | null;
    private getNeighbors;
    private calculateDynamicWeight;
    private countNearbyOhts;
    private predictFutureConflict;
    private reconstructPath;
    private pathToSegments;
    recalculateAllRoutes(): number;
    private needsRouteRecalculation;
    assignRoute(ohtId: string, targetX: number, targetY: number): RouteSegment[] | null;
    getRoutingStats(): {
        successRate: string;
        avgPathLength: string;
        totalRequests: number;
        successfulRoutes: number;
        failedRoutes: number;
        totalPathLength: number;
        collisionAvoidances: number;
    };
    getReservationLookahead(): number;
}
