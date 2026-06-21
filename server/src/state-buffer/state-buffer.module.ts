import { Module } from '@nestjs/common';
import { StateBufferService } from './state-buffer.service';

@Module({
  providers: [StateBufferService],
  exports: [StateBufferService],
})
export class StateBufferModule {}
