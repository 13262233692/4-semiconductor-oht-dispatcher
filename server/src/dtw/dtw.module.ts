import { Module } from '@nestjs/common';
import { DtwService } from './dtw.service';

@Module({
  providers: [DtwService],
  exports: [DtwService],
})
export class DtwModule {}
