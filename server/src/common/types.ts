export enum SecsMessageType {
  DATA_MESSAGE = 0,
  SELECT_REQ = 1,
  SELECT_RSP = 2,
  DESELECT_REQ = 3,
  DESELECT_RSP = 4,
  LINKTEST_REQ = 5,
  LINKTEST_RSP = 6,
  REJECT_REQ = 7,
  SEPARATE_REQ = 9,
}

export interface HsmsHeader {
  sessionId: number;
  headerBytes: number;
  type: SecsMessageType;
  systemBytes: number;
}

export interface SecsMessage {
  header: HsmsHeader;
  stream: number;
  function: number;
  wBit: boolean;
  data?: any;
  rawData?: Buffer;
  timestamp: number;
}

export enum SecsStreamFunction {
  S6F11 = 'S6F11',
  S6F12 = 'S6F12',
  S1F1 = 'S1F1',
  S1F2 = 'S1F2',
  S1F13 = 'S1F13',
  S1F14 = 'S1F14',
}

export interface S6F11EventReport {
  ohtId: string;
  eventId: string;
  eventName: string;
  currentPosition: {
    gridX: number;
    gridY: number;
  };
  speed: number;
  direction: number;
  foupState: FoupState;
  foupId?: string;
  timestamp: number;
}

export enum FoupState {
  EMPTY = 'EMPTY',
  LOADED = 'LOADED',
  PICKING = 'PICKING',
  PLACING = 'PLACING',
}

export interface OhtStatus {
  id: string;
  gridX: number;
  gridY: number;
  worldX: number;
  worldY: number;
  speed: number;
  direction: number;
  foupState: FoupState;
  foupId?: string;
  assignedRoute?: RouteSegment[];
  currentSegmentIndex?: number;
  lastUpdate: number;
  status: 'IDLE' | 'MOVING' | 'PARKING' | 'BLOCKED';
  targetGridX?: number;
  targetGridY?: number;
}

export interface RouteSegment {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  weight: number;
  reserved?: boolean;
  reservedBy?: string;
}

export interface GridCell {
  x: number;
  y: number;
  type: 'TRACK' | 'INTERSECTION' | 'STATION' | 'BUFFER' | 'BLOCKED';
  stationId?: string;
  connections: { x: number; y: number; weight: number }[];
  occupiedBy?: string;
  reservedBy?: string;
  reservedUntil?: number;
}

export interface SpatioTemporalFrame {
  timestamp: number;
  sequence: number;
  ohts: Array<{
    id: string;
    x: number;
    y: number;
    gridX: number;
    gridY: number;
    speed: number;
    direction: number;
    foupState: FoupState;
    foupId?: string;
    status: OhtStatus['status'];
    color: string;
  }>;
  gridMetrics: {
    totalCells: number;
    occupiedCells: number;
    collisionWarnings: number;
  };
}
