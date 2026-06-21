"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var TcpServerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TcpServerService = void 0;
const common_1 = require("@nestjs/common");
const net = require("net");
const events_1 = require("events");
let TcpServerService = TcpServerService_1 = class TcpServerService extends events_1.EventEmitter {
    constructor() {
        super();
        this.logger = new common_1.Logger(TcpServerService_1.name);
        this.clients = new Map();
        this.PORT = parseInt(process.env.TCP_PORT || '5000', 10);
    }
    onModuleInit() {
        this.start();
    }
    onModuleDestroy() {
        this.stop();
    }
    start() {
        this.server = net.createServer((socket) => this.handleConnection(socket));
        this.server.listen(this.PORT, () => {
            this.logger.log(`HSMS TCP Server started on port ${this.PORT}`);
        });
    }
    stop() {
        if (this.server) {
            this.server.close(() => {
                this.logger.log('HSMS TCP Server stopped');
            });
            this.clients.forEach((socket) => socket.destroy());
            this.clients.clear();
        }
    }
    handleConnection(socket) {
        const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
        this.logger.log(`New HSMS connection: ${clientId}`);
        this.clients.set(clientId, socket);
        let buffer = Buffer.alloc(0);
        socket.on('data', (data) => {
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
    extractMessages(buffer) {
        const extracted = [];
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
    sendMessage(clientId, messageBuffer) {
        const socket = this.clients.get(clientId);
        if (socket && !socket.destroyed) {
            socket.write(messageBuffer);
            return true;
        }
        return false;
    }
    broadcast(messageBuffer) {
        this.clients.forEach((socket, clientId) => {
            if (!socket.destroyed) {
                try {
                    socket.write(messageBuffer);
                }
                catch (e) {
                    this.logger.warn(`Failed to broadcast to ${clientId}: ${e.message}`);
                }
            }
        });
    }
    getClientCount() {
        return this.clients.size;
    }
};
exports.TcpServerService = TcpServerService;
exports.TcpServerService = TcpServerService = TcpServerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], TcpServerService);
//# sourceMappingURL=tcp-server.service.js.map