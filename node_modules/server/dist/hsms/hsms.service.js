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
var HsmsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HsmsService = void 0;
const common_1 = require("@nestjs/common");
const tcp_server_service_1 = require("./tcp-server.service");
const secs_parser_service_1 = require("./secs-parser.service");
const types_1 = require("../common/types");
const events_1 = require("events");
let HsmsService = HsmsService_1 = class HsmsService extends events_1.EventEmitter {
    constructor(tcpServer, secsParser) {
        super();
        this.tcpServer = tcpServer;
        this.secsParser = secsParser;
        this.logger = new common_1.Logger(HsmsService_1.name);
    }
    onModuleInit() {
        this.tcpServer.on('raw-message', ({ clientId, data }) => {
            this.handleRawMessage(clientId, data);
        });
        this.logger.log('HSMS Service initialized');
    }
    handleRawMessage(clientId, rawData) {
        const message = this.secsParser.parseHsmsMessage(rawData);
        if (!message) {
            this.logger.warn(`Failed to parse message from ${clientId}`);
            return;
        }
        this.logger.debug(`Parsed HSMS: S${message.stream}F${message.function} (type=${message.header.type}) from ${clientId}`);
        switch (message.header.type) {
            case types_1.SecsMessageType.SELECT_REQ:
                this.handleSelectReq(clientId, message);
                break;
            case types_1.SecsMessageType.LINKTEST_REQ:
                this.handleLinkTestReq(clientId, message);
                break;
            case types_1.SecsMessageType.DATA_MESSAGE:
                this.handleDataMessage(clientId, message);
                break;
            case types_1.SecsMessageType.SEPARATE_REQ:
                this.logger.log(`Received SEPARATE from ${clientId}`);
                break;
            default:
                this.logger.debug(`Unhandled HSMS type: ${message.header.type} from ${clientId}`);
        }
    }
    handleSelectReq(clientId, message) {
        this.logger.log(`SELECT_REQ from ${clientId}`);
        const response = this.secsParser.buildSelectRsp(message.header.systemBytes, 0);
        this.tcpServer.sendMessage(clientId, response);
    }
    handleLinkTestReq(clientId, message) {
        const response = this.secsParser.buildLinkTestRsp(message.header.systemBytes);
        this.tcpServer.sendMessage(clientId, response);
    }
    handleDataMessage(clientId, message) {
        const sfKey = `S${message.stream}F${message.function}`;
        if (sfKey === types_1.SecsStreamFunction.S6F11) {
            const report = message.data;
            this.logger.debug(`S6F11: ${report.ohtId} @ (${report.currentPosition.gridX},${report.currentPosition.gridY}) speed=${report.speed.toFixed(2)}`);
            this.emit('s6f11-report', report);
            if (message.wBit) {
                const s6f12 = this.secsParser.buildS6F12Response(message.header.systemBytes, true);
                this.tcpServer.sendMessage(clientId, s6f12);
            }
        }
        else {
            this.emit('secs-message', { clientId, message });
        }
    }
    getActiveConnections() {
        return this.tcpServer.getClientCount();
    }
};
exports.HsmsService = HsmsService;
exports.HsmsService = HsmsService = HsmsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tcp_server_service_1.TcpServerService,
        secs_parser_service_1.SecsParserService])
], HsmsService);
//# sourceMappingURL=hsms.service.js.map