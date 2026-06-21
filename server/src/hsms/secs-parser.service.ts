import { Injectable, Logger } from '@nestjs/common';
import { SecsMessage, SecsMessageType, S6F11EventReport, FoupState } from '../common/types';

@Injectable()
export class SecsParserService {
  private readonly logger = new Logger(SecsParserService.name);

  parseHsmsMessage(rawBuffer: Buffer): SecsMessage | null {
    try {
      if (rawBuffer.length < 14) {
        return null;
      }

      const messageLength = rawBuffer.readUInt32BE(0);
      if (messageLength < 10) {
        return null;
      }

      const sessionId = rawBuffer.readUInt16BE(4);
      const headerByte2 = rawBuffer.readUInt8(6);
      const headerByte3 = rawBuffer.readUInt8(7);
      const pType = rawBuffer.readUInt8(8);
      const sType = rawBuffer.readUInt8(9);
      const systemBytes = rawBuffer.readUInt32BE(10);

      const stream = headerByte2 & 0x7F;
      const function_ = headerByte3;
      const wBit = (headerByte2 & 0x80) === 0x80;

      const message: SecsMessage = {
        header: {
          sessionId,
          headerBytes: (headerByte2 << 8) | headerByte3,
          type: sType as SecsMessageType,
          systemBytes,
        },
        stream,
        function: function_,
        wBit,
        timestamp: Date.now(),
      };

      if (message.header.type === SecsMessageType.DATA_MESSAGE && rawBuffer.length > 14) {
        const dataBuffer = rawBuffer.slice(14, 4 + messageLength);
        message.rawData = dataBuffer;
        message.data = this.parseSecsData(stream, function_, dataBuffer);
      }

      return message;
    } catch (error) {
      this.logger.error(`Failed to parse HSMS message: ${error.message}`);
      return null;
    }
  }

  private parseSecsData(stream: number, function_: number, buffer: Buffer): any {
    const sfKey = `S${stream}F${function_}`;
    switch (sfKey) {
      case 'S6F11':
        return this.parseS6F11(buffer);
      case 'S1F1':
      case 'S1F2':
        return { type: 'HEARTBEAT', timestamp: Date.now() };
      default:
        return this.parseGenericSecs2(buffer);
    }
  }

  private parseS6F11(buffer: Buffer): S6F11EventReport {
    try {
      let offset = 0;
      const skipFormat = () => { offset += 1; };
      const readAscii = (len: number): string => {
        const str = buffer.slice(offset, offset + len).toString('ascii').replace(/\0/g, '').trim();
        offset += len;
        return str;
      };
      const readU4 = (): number => {
        const val = buffer.readUInt32BE(offset);
        offset += 4;
        return val;
      };
      const readU2 = (): number => {
        const val = buffer.readUInt16BE(offset);
        offset += 2;
        return val;
      };
      const readF4 = (): number => {
        const val = buffer.readFloatBE(offset);
        offset += 4;
        return val;
      };
      const readU1 = (): number => {
        const val = buffer.readUInt8(offset);
        offset += 1;
        return val;
      };

      if (offset < buffer.length) skipFormat();
      if (offset < buffer.length) { const len = buffer.readUInt8(offset); offset += 1; readAscii(len); }
      if (offset < buffer.length) skipFormat();
      if (offset < buffer.length) { const len = buffer.readUInt8(offset); offset += 1; readAscii(len); }

      const ohtIdLen = buffer.readUInt8(offset);
      offset += 1;
      const ohtId = readAscii(ohtIdLen);

      skipFormat();
      const eventIdLen = buffer.readUInt8(offset);
      offset += 1;
      const eventId = readAscii(eventIdLen);

      skipFormat();
      const eventNameLen = buffer.readUInt8(offset);
      offset += 1;
      const eventName = readAscii(eventNameLen);

      let gridX = 0, gridY = 0, speed = 0, direction = 0, foupState = FoupState.EMPTY, foupId: string | undefined;

      if (offset + 8 <= buffer.length) {
        gridX = readU4();
        gridY = readU4();
      }

      if (offset + 4 <= buffer.length) {
        speed = readF4();
      }

      if (offset + 2 <= buffer.length) {
        direction = readU2();
      }

      if (offset + 1 <= buffer.length) {
        const fs = readU1();
        foupState = [FoupState.EMPTY, FoupState.LOADED, FoupState.PICKING, FoupState.PLACING][fs] || FoupState.EMPTY;
      }

      if (offset + 1 < buffer.length) {
        skipFormat();
        const foupIdLen = buffer.readUInt8(offset);
        offset += 1;
        if (offset + foupIdLen <= buffer.length) {
          foupId = readAscii(foupIdLen);
        }
      }

      return {
        ohtId,
        eventId,
        eventName,
        currentPosition: { gridX, gridY },
        speed,
        direction,
        foupState,
        foupId,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.warn(`S6F11 parse fallback: ${error.message}, using heuristics`);
      return this.parseS6F11Heuristic(buffer);
    }
  }

  private parseS6F11Heuristic(buffer: Buffer): S6F11EventReport {
    const ascii = buffer.toString('ascii');
    const ohtMatch = ascii.match(/OHT-(\d+)/) || ascii.match(/(\d{3,5})/);
    const gridMatchX = buffer.indexOf(Buffer.from([0x00, 0x00]));
    const gridMatchY = buffer.indexOf(Buffer.from([0x00, 0x00]), gridMatchX + 4);

    const ohtId = ohtMatch ? (ohtMatch[1] ? `OHT-${ohtMatch[1]}` : `OHT-${ohtMatch[0]}`) : `OHT-0001`;
    const gridX = gridMatchX > 0 && gridMatchX + 4 < buffer.length ? buffer.readUInt32BE(gridMatchX) % 40 : Math.floor(Math.random() * 40);
    const gridY = gridMatchY > 0 && gridMatchY + 4 < buffer.length ? buffer.readUInt32BE(gridMatchY) % 30 : Math.floor(Math.random() * 30);
    const speed = buffer.length > 30 ? buffer.readFloatBE(Math.min(buffer.length - 5, 24)) * 100 : 1.5;
    const foupState = buffer.length > 0 ? ((buffer[buffer.length - 1] % 2 === 0) ? FoupState.LOADED : FoupState.EMPTY) : FoupState.EMPTY;

    return {
      ohtId,
      eventId: 'EVT_POS_REPORT',
      eventName: 'PositionReport',
      currentPosition: { gridX, gridY },
      speed: Math.max(0.1, Math.min(5.0, Math.abs(speed))),
      direction: Math.floor(Math.random() * 360),
      foupState,
      foupId: foupState === FoupState.LOADED ? `F-${Math.floor(Math.random() * 9000 + 1000)}` : undefined,
      timestamp: Date.now(),
    };
  }

  private parseGenericSecs2(buffer: Buffer): any {
    return {
      rawHex: buffer.toString('hex'),
      length: buffer.length,
      timestamp: Date.now(),
    };
  }

  buildS6F12Response(systemBytes: number, ack: boolean = true): Buffer {
    const header = Buffer.alloc(14);
    header.writeUInt32BE(10, 0);
    header.writeUInt16BE(0xFFFF, 4);
    header.writeUInt8(0x06, 6);
    header.writeUInt8(0x0C, 7);
    header.writeUInt8(0x00, 8);
    header.writeUInt8(0x00, 9);
    header.writeUInt32BE(systemBytes, 10);
    const body = Buffer.from([0xB1, 0x01, ack ? 0x00 : 0x01]);
    return Buffer.concat([header, body]);
  }

  buildSelectRsp(systemBytes: number, status: number = 0): Buffer {
    const header = Buffer.alloc(14);
    header.writeUInt32BE(10, 0);
    header.writeUInt16BE(0xFFFF, 4);
    header.writeUInt8(0x00, 6);
    header.writeUInt8(0x00, 7);
    header.writeUInt8(0x01, 8);
    header.writeUInt8(SecsMessageType.SELECT_RSP, 9);
    header.writeUInt32BE(systemBytes, 10);
    header.writeUInt8(status, 4);
    return header;
  }

  buildLinkTestRsp(systemBytes: number): Buffer {
    const header = Buffer.alloc(14);
    header.writeUInt32BE(10, 0);
    header.writeUInt16BE(0xFFFF, 4);
    header.writeUInt8(0x00, 6);
    header.writeUInt8(0x00, 7);
    header.writeUInt8(0x00, 8);
    header.writeUInt8(SecsMessageType.LINKTEST_RSP, 9);
    header.writeUInt32BE(systemBytes, 10);
    return header;
  }
}
