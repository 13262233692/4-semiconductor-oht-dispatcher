import { Module } from '@nestjs/common';
import { StateBufferModule } from '../state-buffer/state-buffer.module';
import { RedisModule } from '../redis/redis.module';
import { RoutingService } from './routing.service';

@Module({
  imports: [StateBufferModule, RedisModule],
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
