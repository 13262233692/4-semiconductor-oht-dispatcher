import { OnModuleInit } from '@nestjs/common';
import { StateBufferService } from '../state-buffer/state-buffer.service';
import { RoutingService } from '../routing/routing.service';
import { EventEmitter } from 'events';
export declare class OhtSimulatorService extends EventEmitter implements OnModuleInit {
    private readonly stateBuffer;
    private readonly routingService;
    private readonly logger;
    private readonly OHT_COUNT;
    private readonly GRID_COLS;
    private readonly GRID_ROWS;
    private readonly ENABLED;
    private ohtInternalStates;
    private stationPositions;
    constructor(stateBuffer: StateBufferService, routingService: RoutingService);
    onModuleInit(): void;
    private discoverStations;
    private initializeOhts;
    private pickRandomTarget;
    simulateTick(): void;
    private processOhtMovement;
    private calculateDirection;
    private handleArrival;
    private emitS6F11Report;
}
