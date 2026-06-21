import { Module } from '@nestjs/common';
import { HsmsService } from './hsms.service';
import { SecsParserService } from './secs-parser.service';
import { TcpServerService } from './tcp-server.service';

@Module({
  providers: [HsmsService, SecsParserService, TcpServerService],
  exports: [HsmsService, SecsParserService, TcpServerService],
})
export class HsmsModule {}
