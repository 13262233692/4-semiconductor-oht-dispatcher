import { OnModuleInit } from '@nestjs/common';
import { OhtStatus, GridCell, S6F11EventReport, RouteSegment } from '../common/types';
export declare class StateBufferService implements OnModuleInit {
    private readonly logger;
    private readonly GRID_COLS;
    private readonly GRID_ROWS;
    private readonly CELL_SIZE;
    private readonly OHT_COUNT;
    private ohtMap;
    private grid;
    private ohtColors;
    constructor();
    onModuleInit(): void;
    private initializeOhtColors;
    private initializeGrid;
    private createGridCell;
    private calculateConnections;
    processS6F11Report(report: S6F11EventReport): OhtStatus;
    private occupyCell;
    private releaseCellReservation;
    getOht(ohtId: string): OhtStatus | undefined;
    getAllOhts(): OhtStatus[];
    getOhtCount(): number;
    getGrid(): GridCell[][];
    getCell(x: number, y: number): GridCell | null;
    getGridDimensions(): {
        cols: number;
        rows: number;
        cellSize: number;
    };
    getOhtColor(ohtId: string): string;
    getColorPalette(): string[];
    setOhtRoute(ohtId: string, route: RouteSegment[]): void;
    advanceOhtSegment(ohtId: string): boolean;
    getGridMetrics(): {
        totalCells: number;
        occupiedCells: number;
        collisionWarnings: number;
    };
    reservePath(ohtId: string, segments: RouteSegment[], timeoutMs?: number): boolean;
    cleanupExpiredReservations(): number;
}
