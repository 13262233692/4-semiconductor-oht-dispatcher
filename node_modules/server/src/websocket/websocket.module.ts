import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { StateBufferModule } from '../state-buffer/state-buffer.module';
import { RoutingModule } from '../routing/routing.module';
import { HsmsModule } from '../hsms/hsms.module';
import { WebsocketGateway } from './websocket.gateway';

@Module({
  imports: [ScheduleModule.forRoot(), StateBufferModule, RoutingModule, HsmsModule],
  providers: [WebsocketGateway],
  exports: [WebsocketGateway],
})
export class WebsocketModule {}
