import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HsmsModule } from './hsms/hsms.module';
import { StateBufferModule } from './state-buffer/state-buffer.module';
import { RoutingModule } from './routing/routing.module';
import { WebsocketModule } from './websocket/websocket.module';
import { SimulatorModule } from './simulator/simulator.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    HsmsModule,
    StateBufferModule,
    RoutingModule,
    WebsocketModule,
    SimulatorModule,
  ],
})
export class AppModule {}
