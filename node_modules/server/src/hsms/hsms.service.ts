import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TcpServerService } from './tcp-server.service';
import { SecsParserService } from './secs-parser.service';
import { SecsMessage, SecsMessageType, S6F11EventReport, SecsStreamFunction } from '../common/types';
import { EventEmitter } from 'events';

@Injectable()
export class HsmsService extends EventEmitter implements OnModuleInit {
  private readonly logger = new Logger(HsmsService.name);

  constructor(
    private readonly tcpServer: TcpServerService,
    private readonly secsParser: SecsParserService,
  ) {
    super();
  }

  onModuleInit() {
    this.tcpServer.on('raw-message', ({ clientId, data }) => {
      this.handleRawMessage(clientId, data);
    });
    this.logger.log('HSMS Service initialized');
  }

  private handleRawMessage(clientId: string, rawData: Buffer) {
    const message = this.secsParser.parseHsmsMessage(rawData);
    if (!message) {
      this.logger.warn(`Failed to parse message from ${clientId}`);
      return;
    }

    this.logger.debug(`Parsed HSMS: S${message.stream}F${message.function} (type=${message.header.type}) from ${clientId}`);

    switch (message.header.type) {
      case SecsMessageType.SELECT_REQ:
        this.handleSelectReq(clientId, message);
        break;
      case SecsMessageType.LINKTEST_REQ:
        this.handleLinkTestReq(clientId, message);
        break;
      case SecsMessageType.DATA_MESSAGE:
        this.handleDataMessage(clientId, message);
        break;
      case SecsMessageType.SEPARATE_REQ:
        this.logger.log(`Received SEPARATE from ${clientId}`);
        break;
      default:
        this.logger.debug(`Unhandled HSMS type: ${message.header.type} from ${clientId}`);
    }
  }

  private handleSelectReq(clientId: string, message: SecsMessage) {
    this.logger.log(`SELECT_REQ from ${clientId}`);
    const response = this.secsParser.buildSelectRsp(message.header.systemBytes, 0);
    this.tcpServer.sendMessage(clientId, response);
  }

  private handleLinkTestReq(clientId: string, message: SecsMessage) {
    const response = this.secsParser.buildLinkTestRsp(message.header.systemBytes);
    this.tcpServer.sendMessage(clientId, response);
  }

  private handleDataMessage(clientId: string, message: SecsMessage) {
    const sfKey = `S${message.stream}F${message.function}` as SecsStreamFunction;

    if (sfKey === SecsStreamFunction.S6F11) {
      const report = message.data as S6F11EventReport;
      this.logger.debug(`S6F11: ${report.ohtId} @ (${report.currentPosition.gridX},${report.currentPosition.gridY}) speed=${report.speed.toFixed(2)}`);
      this.emit('s6f11-report', report);

      if (message.wBit) {
        const s6f12 = this.secsParser.buildS6F12Response(message.header.systemBytes, true);
        this.tcpServer.sendMessage(clientId, s6f12);
      }
    } else {
      this.emit('secs-message', { clientId, message });
    }
  }

  getActiveConnections(): number {
    return this.tcpServer.getClientCount();
  }
}
