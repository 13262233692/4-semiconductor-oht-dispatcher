import { Module } from '@nestjs/common';
import { StateBufferModule } from '../state-buffer/state-buffer.module';
import { RoutingService } from './routing.service';

@Module({
  imports: [StateBufferModule],
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
