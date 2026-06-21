import { createPinia } from 'pinia'
import { defineStore } from 'pinia'
import type {
  SystemInit,
  SystemStatus,
  SpatioTemporalFrame,
  OhtInfo,
  GridDims,
  Station,
  GridCell,
} from '../types'

export const pinia = createPinia()

export const useOhtStore = defineStore('oht', {
  state: () => ({
    _isConnected: false as boolean,
    _lastError: null as string | null,
    _grid: null as GridDims | null,
    _stations: [] as Station[],
    _specialCells: [] as GridCell[],
    _colorPalette: [] as string[],
    _ohts: new Map<string, OhtInfo>(),
    _status: null as SystemStatus | null,
    _latestSequence: 0,
    _framesReceived: 0,
    _framesDropped: 0,
    _avgFrameInterval: 0,
    _lastFrameTime: 0,
    _selectedOhtId: null as string | null,
    _hoveredOhtId: null as string | null,
  }),
  getters: {
    isConnected: (s) => s._isConnected,
    lastError: (s) => s._lastError,
    grid: (s) => s._grid,
    stations: (s) => s._stations,
    specialCells: (s) => s._specialCells,
    colorPalette: (s) => s._colorPalette,
    ohtCount: (s) => s._ohts.size,
    allOhts: (s) => Array.from(s._ohts.values()),
    status: (s) => s._status,
    latestSequence: (s) => s._latestSequence,
    framesReceived: (s) => s._framesReceived,
    avgFps: (s) => (s._avgFrameInterval > 0 ? (1000 / s._avgFrameInterval).toFixed(1) : '0'),
    selectedOht: (s) => (s._selectedOhtId ? s._ohts.get(s._selectedOhtId) || null : null),
    hoveredOht: (s) => (s._hoveredOhtId ? s._ohts.get(s._hoveredOhtId) || null : null),
    movingCount: (s) => Array.from(s._ohts.values()).filter((o) => o.status === 'MOVING').length,
    loadedFoupCount: (s) => Array.from(s._ohts.values()).filter((o) => o.foupState === 'LOADED').length,
  },
  actions: {
    setConnected(v: boolean) {
      this._isConnected = v
      if (v) this._lastError = null
    },
    setError(e: string) {
      this._lastError = e
    },
    applyInit(init: SystemInit) {
      this._grid = init.grid
      this._stations = init.stations
      this._specialCells = init.specialCells
      this._colorPalette = init.colors
      this.applyFrame(init.frame)
    },
    applyFrame(frame: SpatioTemporalFrame) {
      const now = performance.now()

      if (this._lastFrameTime > 0) {
        const interval = now - this._lastFrameTime
        this._avgFrameInterval = this._avgFrameInterval * 0.9 + interval * 0.1
      }
      this._lastFrameTime = now

      if (frame.sequence <= this._latestSequence) {
        this._framesDropped++
        return
      }
      this._latestSequence = frame.sequence
      this._framesReceived++

      const receivedIds = new Set<string>()

      for (const ohtData of frame.ohts) {
        receivedIds.add(ohtData.id)
        const existing = this._ohts.get(ohtData.id)

        if (existing) {
          existing.lastFrameX = existing.displayX ?? existing.x
          existing.lastFrameY = existing.displayY ?? existing.y
          Object.assign(existing, ohtData)
          existing.lastUpdate = now
        } else {
          this._ohts.set(ohtData.id, {
            ...ohtData,
            displayX: ohtData.x,
            displayY: ohtData.y,
            lastFrameX: ohtData.x,
            lastFrameY: ohtData.y,
            lastUpdate: now,
          })
        }
      }

      for (const [id] of this._ohts) {
        if (!receivedIds.has(id)) {
          this._ohts.delete(id)
        }
      }
    },
    applyStatus(status: SystemStatus) {
      this._status = status
    },
    setSelectedOht(id: string | null) {
      this._selectedOhtId = id
    },
    setHoveredOht(id: string | null) {
      this._hoveredOhtId = id
    },
    getOht(id: string): OhtInfo | undefined {
      return this._ohts.get(id)
    },
    updateDisplayPositions(interpolationFactor: number) {
      const t = Math.min(1, Math.max(0, interpolationFactor))
      for (const oht of this._ohts.values()) {
        const fromX = oht.lastFrameX ?? oht.x
        const fromY = oht.lastFrameY ?? oht.y
        oht.displayX = fromX + (oht.x - fromX) * t
        oht.displayY = fromY + (oht.y - fromY) * t
      }
    },
  },
})
