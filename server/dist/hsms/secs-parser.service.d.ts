import { SecsMessage } from '../common/types';
export declare class SecsParserService {
    private readonly logger;
    parseHsmsMessage(rawBuffer: Buffer): SecsMessage | null;
    private parseSecsData;
    private parseS6F11;
    private parseS6F11Heuristic;
    private parseGenericSecs2;
    buildS6F12Response(systemBytes: number, ack?: boolean): Buffer;
    buildSelectRsp(systemBytes: number, status?: number): Buffer;
    buildLinkTestRsp(systemBytes: number): Buffer;
}
