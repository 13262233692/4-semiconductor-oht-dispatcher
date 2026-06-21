import { Module } from '@nestjs/common';
import { BeltFatigueService } from './belt-fatigue.service';
import { DtwModule } from '../dtw/dtw.module';

@Module({
  imports: [DtwModule],
  providers: [BeltFatigueService],
  exports: [BeltFatigueService],
})
export class BeltFatigueModule {}
