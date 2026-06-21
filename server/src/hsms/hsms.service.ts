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

  sendHostCommand(
    clientId: string,
    commandId: string,
    params: Array<{ name: string; value: string }> = [],
  ): boolean {
    const systemBytes = Math.floor(Math.random() * 0xffffffff);
    const msg = this.secsParser.buildS2F41HostCommand(systemBytes, commandId, params, true);
    const success = this.tcpServer.sendMessage(clientId, msg);
    if (success) {
      this.logger.log(`S2F41 sent to ${clientId}: ${commandId} (sys=0x${systemBytes.toString(16)})`);
    } else {
      this.logger.warn(`Failed to send S2F41 to ${clientId}: ${commandId}`);
    }
    return success;
  }

  sendEmergencyDetach(ohtId: string, targetStation: string = 'ST-09'): boolean {
    const clientId = this.findClientByOhtId(ohtId);
    if (!clientId) {
      this.logger.error(`Cannot send emergency detach: no client for OHT ${ohtId}`);
      return false;
    }
    const systemBytes = Math.floor(Math.random() * 0xffffffff);
    const msg = this.secsParser.buildEmergencyDetachCommand(systemBytes, ohtId, targetStation);
    const success = this.tcpServer.sendMessage(clientId, msg);
    if (success) {
      this.logger.warn(
        `🚨 EMERGENCY DETACH SENT to ${ohtId} via ${clientId}, diverting to ${targetStation}`,
      );
    }
    return success;
  }

  private ohtClientMap: Map<string, string> = new Map();

  registerOhtClient(ohtId: string, clientId: string) {
    this.ohtClientMap.set(ohtId, clientId);
  }

  findClientByOhtId(ohtId: string): string | undefined {
    return this.ohtClientMap.get(ohtId);
  }
}
