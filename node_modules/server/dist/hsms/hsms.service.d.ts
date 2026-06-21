import { OnModuleInit } from '@nestjs/common';
import { TcpServerService } from './tcp-server.service';
import { SecsParserService } from './secs-parser.service';
import { EventEmitter } from 'events';
export declare class HsmsService extends EventEmitter implements OnModuleInit {
    private readonly tcpServer;
    private readonly secsParser;
    private readonly logger;
    constructor(tcpServer: TcpServerService, secsParser: SecsParserService);
    onModuleInit(): void;
    private handleRawMessage;
    private handleSelectReq;
    private handleLinkTestReq;
    private handleDataMessage;
    getActiveConnections(): number;
}
