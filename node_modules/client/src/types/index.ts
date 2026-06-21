export enum FoupState {
  EMPTY = 'EMPTY',
  LOADED = 'LOADED',
  PICKING = 'PICKING',
  PLACING = 'PLACING',
}

export type OhtStatusType = 'IDLE' | 'MOVING' | 'PARKING' | 'BLOCKED'

export interface OhtFrameData {
  id: string
  x: number
  y: number
  gridX: number
  gridY: number
  speed: number
  direction: number
  foupState: FoupState
  foupId?: string
  status: OhtStatusType
  color: string
}

export interface OhtInfo extends OhtFrameData {
  displayX?: number
  displayY?: number
  lastFrameX?: number
  lastFrameY?: number
  lastUpdate: number
}

export interface GridCell {
  x: number
  y: number
  type: 'TRACK' | 'INTERSECTION' | 'STATION' | 'BUFFER' | 'BLOCKED'
  stationId?: string
  occupiedBy?: string
  reservedBy?: string
}

export interface Station {
  x: number
  y: number
  stationId: string
}

export interface GridDims {
  cols: number
  rows: number
  cellSize: number
  worldWidth: number
  worldHeight: number
}

export interface SpatioTemporalFrame {
  timestamp: number
  sequence: number
  ohts: OhtFrameData[]
  gridMetrics: {
    totalCells: number
    occupiedCells: number
    collisionWarnings: number
  }
}

export interface SystemStatus {
  timestamp: number
  activeConnections: number
  wsClients: number
  ohtCount: number
  grid: GridDims
  metrics: {
    totalCells: number
    occupiedCells: number
    collisionWarnings: number
  }
  routing: {
    totalRequests: number
    successfulRoutes: number
    failedRoutes: number
    collisionAvoidances: number
    successRate: string
    avgPathLength: string
  }
}

export interface SystemInit {
  timestamp: number
  grid: GridDims
  stations: Station[]
  specialCells: GridCell[]
  colors: string[]
  frame: SpatioTemporalFrame
}
