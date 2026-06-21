import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { StateBufferModule } from '../state-buffer/state-buffer.module';
import { RoutingModule } from '../routing/routing.module';
import { OhtSimulatorService } from './oht-simulator.service';

@Module({
  imports: [ScheduleModule.forRoot(), StateBufferModule, RoutingModule],
  providers: [OhtSimulatorService],
  exports: [OhtSimulatorService],
})
export class SimulatorModule {}
