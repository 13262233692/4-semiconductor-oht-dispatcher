import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: '*',
      credentials: true,
    },
  });

  const httpPort = parseInt(process.env.HTTP_PORT || '3000', 10);
  const tcpPort = parseInt(process.env.TCP_PORT || '5000', 10);

  await app.listen(httpPort);
  logger.log(`HTTP/WebSocket Server running on http://localhost:${httpPort}`);
  logger.log(`HSMS TCP Server listening on port ${tcpPort}`);
}

bootstrap();
