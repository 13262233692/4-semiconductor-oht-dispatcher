import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as net from 'net';
import { EventEmitter } from 'events';
import { SecsMessage, SecsStreamFunction } from '../common/types';

interface SocketState {
  socket: net.Socket;
  clientId: string;
  buffer: Buffer;
  boundHandlers: Map<string, (...args: any[]) => void>;
  isDestroyed: boolean;
  connectedAt: number;
  lastActivityAt: number;
  reconnectAttempts: number;
}

@Injectable()
export class TcpServerService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TcpServerService.name);
  private server: net.Server;
  private sockets: Map<string, SocketState> = new Map();
  private readonly PORT: number;
  private readonly MAX_RECONNECT_DELAY = 5000;
  private isShuttingDown = false;

  constructor() {
    super();
    this.setMaxListeners(200);
    this.PORT = parseInt(process.env.TCP_PORT || '5000', 10);
  }

  onModuleInit() {
    this.start();
  }

  onModuleDestroy() {
    this.isShuttingDown = true;
    this.stop();
  }

  private start() {
    this.server = net.createServer({ allowHalfOpen: false, pauseOnConnect: false }, (socket) =>
      this.handleConnection(socket),
    );

    this.server.on('error', (err) => {
      this.logger.error(`Server error: ${err.message}`);
      if ((err as any).code === 'EADDRINUSE') {
        this.logger.error(`Port ${this.PORT} already in use, retrying in 3s...`);
        setTimeout(() => {
          if (!this.isShuttingDown) {
            this.server.close();
            this.server.listen(this.PORT);
          }
        }, 3000);
      }
    });

    this.server.listen(this.PORT, () => {
      this.logger.log(`HSMS TCP Server started on port ${this.PORT}`);
    });
  }

  private stop() {
    if (this.server) {
      this.server.close(() => {
        this.logger.log('HSMS TCP Server stopped');
      });
    }
    this.cleanupAllSockets();
  }

  private handleConnection(socket: net.Socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    const now = Date.now();

    this.logger.log(`New HSMS connection: ${clientId}`);

    const existing = this.sockets.get(clientId);
    if (existing) {
      this.logger.warn(`Cleaning up previous socket state for ${clientId}`);
      this.cleanupSocketState(clientId);
    }

    socket.setKeepAlive(true, 30000);
    socket.setNoDelay(true);
    socket.setTimeout(60000);

    const state: SocketState = {
      socket,
      clientId,
      buffer: Buffer.alloc(0),
      boundHandlers: new Map(),
      isDestroyed: false,
      connectedAt: now,
      lastActivityAt: now,
      reconnectAttempts: 0,
    };

    this.sockets.set(clientId, state);

    const handleData = this.createDataHandler(state);
    const handleClose = this.createCloseHandler(state);
    const handleError = this.createErrorHandler(state);
    const handleTimeout = this.createTimeoutHandler(state);

    state.boundHandlers.set('data', handleData);
    state.boundHandlers.set('close', handleClose);
    state.boundHandlers.set('error', handleError);
    state.boundHandlers.set('timeout', handleTimeout);

    socket.on('data', handleData);
    socket.once('close', handleClose);
    socket.once('error', handleError);
    socket.on('timeout', handleTimeout);

    this.emit('client-connected', clientId);
  }

  private createDataHandler(state: SocketState): (data: Buffer) => void {
    return (data: Buffer) => {
      if (state.isDestroyed) {
        this.logger.debug(`[${state.clientId}] Received data on destroyed socket, discarding ${data.length} bytes`);
        return;
      }

      state.lastActivityAt = Date.now();

      try {
        state.buffer = Buffer.concat([state.buffer, data]);
        this.logger.debug(
          `[${state.clientId}] Received ${data.length} bytes, buffer: ${state.buffer.length}`,
        );

        const result = this.extractMessages(state.buffer);
        if (result.extracted.length > 0) {
          state.buffer = Buffer.from(result.remaining);
          for (const msg of result.extracted) {
            this.emit('raw-message', { clientId: state.clientId, data: msg });
          }
        }
      } catch (error) {
        this.logger.error(`[${state.clientId}] Data handling error: ${error.message}`);
        this.scheduleReconnect(state);
      }
    };
  }

  private createCloseHandler(state: SocketState): (hadError: boolean) => void {
    return (hadError: boolean) => {
      if (state.isDestroyed) return;
      state.isDestroyed = true;

      this.logger.log(
        `[${state.clientId}] Connection closed ${hadError ? '(with error)' : ''}`,
      );

      this.removeAllSocketListeners(state);

      this.emit('client-disconnected', { clientId: state.clientId, hadError });

      if (!this.isShuttingDown && hadError) {
        this.scheduleReconnect(state);
      } else {
        this.cleanupSocketState(state.clientId);
      }
    };
  }

  private createErrorHandler(state: SocketState): (err: Error) => void {
    return (err: Error) => {
      if (state.isDestroyed) return;

      this.logger.error(`[${state.clientId}] Socket error: ${err.message}`);

      if (err.message.includes('ECONNRESET') || err.message.includes('EPIPE')) {
        state.socket.destroy();
      } else {
        this.scheduleReconnect(state);
      }
    };
  }

  private createTimeoutHandler(state: SocketState): () => void {
    return () => {
      if (state.isDestroyed) return;

      const idleMs = Date.now() - state.lastActivityAt;
      this.logger.warn(`[${state.clientId}] Socket timeout after ${idleMs}ms idle`);

      try {
        state.socket.end();
      } catch (e) {
        this.logger.warn(`[${state.clientId}] Error during timeout end: ${e.message}`);
      }
    };
  }

  private removeAllSocketListeners(state: SocketState) {
    state.boundHandlers.forEach((handler, event) => {
      try {
        state.socket.removeListener(event, handler);
      } catch (e) {
        this.logger.debug(`[${state.clientId}] Error removing ${event} listener: ${e.message}`);
      }
    });
    state.boundHandlers.clear();

    try {
      state.socket.removeAllListeners('data');
      state.socket.removeAllListeners('close');
      state.socket.removeAllListeners('error');
      state.socket.removeAllListeners('timeout');
      state.socket.removeAllListeners();
    } catch (e) {
      this.logger.debug(`[${state.clientId}] Error in removeAllListeners: ${e.message}`);
    }
  }

  private cleanupSocketState(clientId: string) {
    const state = this.sockets.get(clientId);
    if (!state) return;

    this.logger.debug(`[${clientId}] Cleaning up socket state`);

    this.removeAllSocketListeners(state);

    try {
      if (!state.socket.destroyed) {
        state.socket.destroy();
      }
    } catch (e) {
      this.logger.debug(`[${clientId}] Error destroying socket: ${e.message}`);
    }

    state.buffer = Buffer.alloc(0);
    state.isDestroyed = true;

    this.sockets.delete(clientId);
  }

  private cleanupAllSockets() {
    this.logger.log(`Cleaning up ${this.sockets.size} sockets`);
    for (const clientId of Array.from(this.sockets.keys())) {
      this.cleanupSocketState(clientId);
    }
  }

  private scheduleReconnect(state: SocketState) {
    if (this.isShuttingDown || state.isDestroyed) return;

    state.reconnectAttempts++;
    const delay = Math.min(state.reconnectAttempts * 200, this.MAX_RECONNECT_DELAY);

    this.logger.warn(
      `[${state.clientId}] Scheduling reconnect attempt #${state.reconnectAttempts} in ${delay}ms`,
    );

    setTimeout(() => {
      if (this.isShuttingDown || state.isDestroyed) return;

      this.logger.log(`[${state.clientId}] Attempting reconnect...`);

      try {
        this.removeAllSocketListeners(state);
        if (!state.socket.destroyed) {
          state.socket.destroy();
        }
      } catch (e) {
        this.logger.debug(`[${state.clientId}] Pre-reconnect cleanup error: ${e.message}`);
      }

      this.cleanupSocketState(state.clientId);
      this.emit('reconnect-attempt', state.clientId);
    }, delay);
  }

  private extractMessages(buffer: Buffer): { extracted: Buffer[]; remaining: Buffer } {
    const extracted: Buffer[] = [];
    let offset = 0;

    while (offset + 4 <= buffer.length) {
      const messageLength = buffer.readUInt32BE(offset);
      if (messageLength > 1048576) {
        this.logger.warn(`Message too large (${messageLength} bytes), discarding buffer`);
        return { extracted, remaining: Buffer.alloc(0) };
      }
      const totalLength = 4 + messageLength;
      if (offset + totalLength > buffer.length) break;
      extracted.push(buffer.slice(offset, offset + totalLength));
      offset += totalLength;
    }

    return {
      extracted,
      remaining: offset > 0 ? buffer.slice(offset) : buffer,
    };
  }

  sendMessage(clientId: string, messageBuffer: Buffer): boolean {
    const state = this.sockets.get(clientId);
    if (!state || state.isDestroyed || state.socket.destroyed) {
      return false;
    }

    try {
      return state.socket.write(messageBuffer);
    } catch (error) {
      this.logger.error(`[${clientId}] Send error: ${error.message}`);
      return false;
    }
  }

  broadcast(messageBuffer: Buffer) {
    let sent = 0;
    let failed = 0;

    this.sockets.forEach((state, clientId) => {
      if (state.isDestroyed || state.socket.destroyed) {
        failed++;
        return;
      }
      try {
        if (state.socket.write(messageBuffer)) {
          sent++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
        this.logger.warn(`[${clientId}] Broadcast failed: ${e.message}`);
      }
    });

    if (failed > 0) {
      this.logger.debug(`Broadcast: ${sent} sent, ${failed} failed`);
    }
  }

  getClientCount(): number {
    return this.sockets.size;
  }

  getActiveClientIds(): string[] {
    return Array.from(this.sockets.keys());
  }

  getSocketStats(): { connected: number; destroyed: number; reconnecting: number } {
    let connected = 0,
      destroyed = 0,
      reconnecting = 0;
    this.sockets.forEach((state) => {
      if (state.isDestroyed) destroyed++;
      else if (state.reconnectAttempts > 0) reconnecting++;
      else connected++;
    });
    return { connected, destroyed, reconnecting };
  }
}
