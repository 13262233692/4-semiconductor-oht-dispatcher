import { Module } from '@nestjs/common';
import { VibrationIngestService } from './vibration-ingest.service';
import { BeltFatigueModule } from '../belt-fatigue/belt-fatigue.module';
import { HsmsModule } from '../hsms/hsms.module';

@Module({
  imports: [BeltFatigueModule, HsmsModule],
  providers: [VibrationIngestService],
  exports: [VibrationIngestService],
})
export class VibrationIngestModule {}
