import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as net from 'net';
import { EventEmitter } from 'events';
import { SecsMessage, SecsStreamFunction } from '../common/types';

@Injectable()
export class TcpServerService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TcpServerService.name);
  private server: net.Server;
  private clients: Map<string, net.Socket> = new Map();
  private readonly PORT: number;

  constructor() {
    super();
    this.PORT = parseInt(process.env.TCP_PORT || '5000', 10);
  }

  onModuleInit() {
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  private start() {
    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.server.listen(this.PORT, () => {
      this.logger.log(`HSMS TCP Server started on port ${this.PORT}`);
    });
  }

  private stop() {
    if (this.server) {
      this.server.close(() => {
        this.logger.log('HSMS TCP Server stopped');
      });
      this.clients.forEach((socket) => socket.destroy());
      this.clients.clear();
    }
  }

  private handleConnection(socket: net.Socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    this.logger.log(`New HSMS connection: ${clientId}`);
    this.clients.set(clientId, socket);

    let buffer = Buffer.alloc(0);

    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      this.logger.debug(`Received ${data.length} bytes from ${clientId}, buffer size: ${buffer.length}`);
      const messages = this.extractMessages(buffer);
      if (messages.extracted.length > 0) {
        buffer = Buffer.from(messages.remaining);
        messages.extracted.forEach((msg) => {
          this.emit('raw-message', { clientId, data: msg });
        });
      }
    });

    socket.on('close', () => {
      this.logger.log(`HSMS connection closed: ${clientId}`);
      this.clients.delete(clientId);
      this.emit('client-disconnected', clientId);
    });

    socket.on('error', (err) => {
      this.logger.error(`HSMS socket error (${clientId}): ${err.message}`);
      this.clients.delete(clientId);
    });
  }

  private extractMessages(buffer: Buffer): { extracted: Buffer[]; remaining: Buffer } {
    const extracted: Buffer[] = [];
    let offset = 0;

    while (offset + 4 <= buffer.length) {
      const messageLength = buffer.readUInt32BE(offset);
      const totalLength = 4 + messageLength;

      if (offset + totalLength > buffer.length) {
        break;
      }

      extracted.push(buffer.slice(offset, offset + totalLength));
      offset += totalLength;
    }

    return {
      extracted,
      remaining: offset > 0 ? buffer.slice(offset) : buffer,
    };
  }

  sendMessage(clientId: string, messageBuffer: Buffer): boolean {
    const socket = this.clients.get(clientId);
    if (socket && !socket.destroyed) {
      socket.write(messageBuffer);
      return true;
    }
    return false;
  }

  broadcast(messageBuffer: Buffer) {
    this.clients.forEach((socket, clientId) => {
      if (!socket.destroyed) {
        try {
          socket.write(messageBuffer);
        } catch (e) {
          this.logger.warn(`Failed to broadcast to ${clientId}: ${e.message}`);
        }
      }
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
