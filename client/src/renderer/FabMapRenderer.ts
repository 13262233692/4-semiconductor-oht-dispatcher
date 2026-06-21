import * as PIXI from 'pixi.js'
import type { GridDims, Station, GridCell, OhtInfo, FoupState } from '../types'
import { useOhtStore } from '../store/ohtStore'

const COLORS = {
  trackFill: 0x1e293b,
  gridLine: 0x283448,
  gridLineMajor: 0x374151,
  intersection: 0xd97706,
  station: 0x059669,
  buffer: 0x0891b2,
  blocked: 0x7f1d1d,
  stationLabel: 0xffffff,
  axisLabel: 0x475569,
  ohtShadow: 0x000000,
}

export interface RendererViewport {
  scale: number
  offsetX: number
  offsetY: number
}

export class FabMapRenderer {
  private app: PIXI.Application | null = null
  private container: HTMLElement
  private store: ReturnType<typeof useOhtStore>

  private worldLayer: PIXI.Container | null = null
  private gridLayer: PIXI.Container | null = null
  private cellLayer: PIXI.Container | null = null
  private stationLayer: PIXI.Container | null = null
  private labelLayer: PIXI.Container | null = null
  private ohtLayer: PIXI.Container | null = null
  private ohtTopLayer: PIXI.Container | null = null
  private highlightLayer: PIXI.Container | null = null

  private ohtSprites: Map<string, {
    body: PIXI.Graphics
    directionArrow: PIXI.Graphics
    foupIndicator: PIXI.Graphics
    halo: PIXI.Graphics
    label: PIXI.Text
    container: PIXI.Container
  }> = new Map()

  private dims: GridDims | null = null
  private viewport: RendererViewport = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  }

  private isDragging = false
  private lastMouseX = 0
  private lastMouseY = 0
  private rafId = 0
  private lastFrameTime = 0
  private interpolationFactor = 0

  private hoverTarget: PIXI.Container | null = null
  private selectedTarget: PIXI.Container | null = null
  private onOhtClick?: (id: string) => void
  private onOhtHover?: (id: string | null) => void
  private onViewportChange?: (vp: RendererViewport) => void

  constructor(
    container: HTMLElement,
    store: ReturnType<typeof useOhtStore>,
  ) {
    this.container = container
    this.store = store
  }

  setCallbacks(cbs: {
    onOhtClick?: (id: string) => void
    onOhtHover?: (id: string | null) => void
    onViewportChange?: (vp: RendererViewport) => void
  }) {
    this.onOhtClick = cbs.onOhtClick
    this.onOhtHover = cbs.onOhtHover
    this.onViewportChange = cbs.onViewportChange
  }

  async init() {
    if (this.app) return

    const width = this.container.clientWidth
    const height = this.container.clientHeight

    this.app = new PIXI.Application({
      width,
      height,
      backgroundColor: 0x0a0e1a,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })

    this.container.appendChild(this.app.view as any)

    this.worldLayer = new PIXI.Container()
    this.app.stage.addChild(this.worldLayer)

    this.gridLayer = new PIXI.Container()
    this.cellLayer = new PIXI.Container()
    this.stationLayer = new PIXI.Container()
    this.labelLayer = new PIXI.Container()
    this.ohtLayer = new PIXI.Container()
    this.ohtTopLayer = new PIXI.Container()
    this.highlightLayer = new PIXI.Container()

    this.worldLayer.addChild(this.gridLayer)
    this.worldLayer.addChild(this.cellLayer)
    this.worldLayer.addChild(this.stationLayer)
    this.worldLayer.addChild(this.labelLayer)
    this.worldLayer.addChild(this.ohtLayer)
    this.worldLayer.addChild(this.ohtTopLayer)
    this.worldLayer.addChild(this.highlightLayer)

    this.setupInteraction()
    this.startRenderLoop()
    window.addEventListener('resize', this.handleResize)
  }

  private handleResize = () => {
    if (!this.app) return
    this.app.renderer.resize(
      this.container.clientWidth,
      this.container.clientHeight,
    )
    this.autoFitView()
  }

  autoFitView() {
    if (!this.app || !this.dims) return
    const { worldWidth, worldHeight } = this.dims
    const appW = this.app.renderer.width
    const appH = this.app.renderer.height
    const padding = 40
    const scale = Math.min(
      (appW - padding * 2) / worldWidth,
      (appH - padding * 2) / worldHeight,
    )
    this.viewport.scale = Math.max(0.3, Math.min(scale, 3))
    this.viewport.offsetX = (appW - worldWidth * this.viewport.scale) / 2
    this.viewport.offsetY = (appH - worldHeight * this.viewport.scale) / 2
    this.applyViewport()
  }

  zoom(factor: number, cx?: number, cy?: number) {
    if (!this.app) return
    const appW = this.app.renderer.width
    const appH = this.app.renderer.height
    const pivotX = cx ?? appW / 2
    const pivotY = cy ?? appH / 2

    const newScale = Math.max(0.2, Math.min(this.viewport.scale * factor, 6))
    const ratio = newScale / this.viewport.scale

    this.viewport.offsetX = pivotX - (pivotX - this.viewport.offsetX) * ratio
    this.viewport.offsetY = pivotY - (pivotY - this.viewport.offsetY) * ratio
    this.viewport.scale = newScale

    this.applyViewport()
  }

  resetView() {
    this.autoFitView()
  }

  private applyViewport() {
    if (!this.worldLayer) return
    this.worldLayer.x = this.viewport.offsetX
    this.worldLayer.y = this.viewport.offsetY
    this.worldLayer.scale.set(this.viewport.scale)
    this.onViewportChange?.(this.viewport)
  }

  private setupInteraction() {
    if (!this.app) return
    const view = this.app.view as HTMLCanvasElement

    view.addEventListener('pointerdown', (e) => {
      this.isDragging = true
      this.lastMouseX = e.clientX
      this.lastMouseY = e.clientY
      view.setPointerCapture(e.pointerId)
    })

    view.addEventListener('pointermove', (e) => {
      if (this.isDragging) {
        const dx = e.clientX - this.lastMouseX
        const dy = e.clientY - this.lastMouseY
        this.viewport.offsetX += dx
        this.viewport.offsetY += dy
        this.lastMouseX = e.clientX
        this.lastMouseY = e.clientY
        this.applyViewport()
      }
      this.handlePointerMove(e)
    })

    view.addEventListener('pointerup', (e) => {
      this.isDragging = false
      try { view.releasePointerCapture(e.pointerId) } catch {}
    })

    view.addEventListener('pointercancel', () => {
      this.isDragging = false
    })

    view.addEventListener('wheel', (e) => {
      e.preventDefault()
      const rect = view.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      this.zoom(factor, x, y)
    }, { passive: false })

    view.addEventListener('click', this.handleClick as any)
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.viewport.offsetX) / this.viewport.scale,
      y: (sy - this.viewport.offsetY) / this.viewport.scale,
    }
  }

  private handlePointerMove(e: PointerEvent) {
    if (!this.app || !this.dims) return
    const view = this.app.view as HTMLCanvasElement
    const rect = view.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { x: wx, y: wy } = this.screenToWorld(sx, sy)

    let found: string | null = null
    const ohts = this.store.allOhts
    const hitRadius = 18 / this.viewport.scale

    for (const oht of ohts) {
      const dx = wx - oht.x
      const dy = wy - oht.y
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        found = oht.id
        break
      }
    }

    if (found) {
      this.setOhtHover(found)
      this.onOhtHover?.(found)
    } else if (this.hoverTarget) {
      this.clearOhtHover()
      this.onOhtHover?.(null)
    }
  }

  private handleClick = (e: MouseEvent) => {
    if (this.isDragging) return
    if (!this.app || !this.dims) return

    const view = this.app.view as HTMLCanvasElement
    const rect = view.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { x: wx, y: wy } = this.screenToWorld(sx, sy)

    let clickedId: string | null = null
    const hitRadius = 18 / this.viewport.scale
    const ohts = this.store.allOhts

    for (const oht of ohts) {
      const dx = wx - oht.x
      const dy = wy - oht.y
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        clickedId = oht.id
        break
      }
    }

    if (clickedId) {
      this.setSelectedOht(clickedId)
      this.onOhtClick?.(clickedId)
    } else if (this.store.selectedOhtId) {
      this.setSelectedOht(null)
      this.onOhtClick?.(this.store.selectedOhtId!)
    }
  }

  buildMap(dims: GridDims, stations: Station[], specialCells: GridCell[]) {
    this.dims = dims
    this.clearLayers()
    this.drawGrid(dims)
    this.drawSpecialCells(dims, specialCells)
    this.drawStations(dims, stations)
    this.drawAxisLabels(dims)
    this.autoFitView()
  }

  private clearLayers() {
    this.gridLayer?.removeChildren()
    this.cellLayer?.removeChildren()
    this.stationLayer?.removeChildren()
    this.labelLayer?.removeChildren()
    this.highlightLayer?.removeChildren()
  }

  private drawGrid(dims: GridDims) {
    if (!this.gridLayer) return
    const g = new PIXI.Graphics()
    const { cols, rows, cellSize, worldWidth, worldHeight } = dims

    g.lineStyle(1, COLORS.gridLine, 0.4)
    for (let x = 0; x <= cols; x++) {
      const px = x * cellSize
      g.moveTo(px, 0)
      g.lineTo(px, worldHeight)
    }
    for (let y = 0; y <= rows; y++) {
      const py = y * cellSize
      g.moveTo(0, py)
      g.lineTo(worldWidth, py)
    }

    g.lineStyle(1.5, COLORS.gridLineMajor, 0.8)
    for (let x = 0; x <= cols; x += 5) {
      const px = x * cellSize
      g.moveTo(px, 0)
      g.lineTo(px, worldHeight)
    }
    for (let y = 0; y <= rows; y += 5) {
      const py = y * cellSize
      g.moveTo(0, py)
      g.lineTo(worldWidth, py)
    }

    g.lineStyle(2, 0x3b82f6, 0.8)
    g.drawRect(0, 0, worldWidth, worldHeight)

    this.gridLayer.addChild(g)
  }

  private drawSpecialCells(dims: GridDims, cells: GridCell[]) {
    if (!this.cellLayer) return
    const g = new PIXI.Graphics()
    const { cellSize } = dims
    const pad = 2

    for (const cell of cells) {
      const x = cell.x * cellSize + pad
      const y = cell.y * cellSize + pad
      const size = cellSize - pad * 2

      switch (cell.type) {
        case 'INTERSECTION':
          g.beginFill(COLORS.intersection, 0.25)
          g.lineStyle(1, COLORS.intersection, 0.6)
          g.drawRoundedRect(x, y, size, size, 4)
          g.endFill()
          g.beginFill(COLORS.intersection, 0.5)
          g.drawCircle(x + size / 2, y + size / 2, 3)
          g.endFill()
          break
        case 'BUFFER':
          g.beginFill(COLORS.buffer, 0.2)
          g.lineStyle(1, COLORS.buffer, 0.5)
          g.drawRoundedRect(x, y, size, size, 4)
          g.endFill()
          break
        case 'BLOCKED':
          g.beginFill(COLORS.blocked, 0.45)
          g.lineStyle(1, COLORS.blocked, 0.8)
          g.drawRoundedRect(x, y, size, size, 3)
          g.endFill()
          g.lineStyle(1.5, 0xff6b6b, 0.8)
          g.moveTo(x + 4, y + 4)
          g.lineTo(x + size - 4, y + size - 4)
          g.moveTo(x + size - 4, y + 4)
          g.lineTo(x + 4, y + size - 4)
          break
      }
    }
    this.cellLayer.addChild(g)
  }

  private drawStations(dims: GridDims, stations: Station[]) {
    if (!this.stationLayer || !this.labelLayer) return
    const g = new PIXI.Graphics()
    const { cellSize } = dims
    const pad = 3

    for (const st of stations) {
      const x = st.x * cellSize + pad
      const y = st.y * cellSize + pad
      const size = cellSize - pad * 2

      g.beginFill(COLORS.station, 0.3)
      g.lineStyle(1.5, COLORS.station, 0.9)
      g.drawRoundedRect(x, y, size, size, 5)
      g.endFill()

      g.beginFill(COLORS.station, 0.7)
      g.drawRoundedRect(x + size * 0.15, y + size * 0.15, size * 0.7, size * 0.7, 3)
      g.endFill()

      const label = new PIXI.Text(st.stationId, {
        fontFamily: 'Consolas, monospace',
        fontSize: 9,
        fill: COLORS.stationLabel,
        align: 'center',
        fontWeight: '700',
      })
      label.anchor.set(0.5)
      label.x = x + size / 2
      label.y = y + size + 9
      label.resolution = 2
      this.labelLayer.addChild(label)
    }
    this.stationLayer.addChild(g)
  }

  private drawAxisLabels(dims: GridDims) {
    if (!this.labelLayer) return
    const { cols, rows, cellSize } = dims
    const styleX = {
      fontFamily: 'Consolas, monospace',
      fontSize: 8,
      fill: COLORS.axisLabel,
      align: 'center',
    }
    const styleY = {
      fontFamily: 'Consolas, monospace',
      fontSize: 8,
      fill: COLORS.axisLabel,
      align: 'right',
    }

    for (let x = 0; x <= cols; x += 10) {
      const lbl = new PIXI.Text(String(x), styleX)
      lbl.anchor.set(0.5, 1)
      lbl.x = x * cellSize
      lbl.y = -3
      lbl.resolution = 2
      this.labelLayer.addChild(lbl)
    }
    for (let y = 0; y <= rows; y += 10) {
      const lbl = new PIXI.Text(String(y), styleY)
      lbl.anchor.set(1, 0.5)
      lbl.x = -3
      lbl.y = y * cellSize
      lbl.resolution = 2
      this.labelLayer.addChild(lbl)
    }
  }

  private setOhtHover(ohtId: string) {
    const spr = this.ohtSprites.get(ohtId)
    if (!spr) return
    this.hoverTarget = spr.container
    spr.halo.alpha = 0.4
    if (this.selectedTarget !== spr.container) {
      this.ohtTopLayer?.addChild(spr.container)
    }
  }

  private clearOhtHover() {
    if (!this.hoverTarget) return
    const ohtId = (this.hoverTarget as any)._ohtId
    const spr = this.ohtSprites.get(ohtId)
    if (spr) {
      spr.halo.alpha = 0
      if (this.selectedTarget !== spr.container) {
        this.ohtLayer?.addChild(spr.container)
      }
    }
    this.hoverTarget = null
  }

  setSelectedOht(ohtId: string | null) {
    if (this.selectedTarget) {
      const prevId = (this.selectedTarget as any)._ohtId
      const prev = this.ohtSprites.get(prevId)
      if (prev) {
        prev.halo.tint = 0xffffff
        prev.halo.scale.set(1)
        this.ohtLayer?.addChild(prev.container)
      }
      this.selectedTarget = null
    }

    if (ohtId) {
      const spr = this.ohtSprites.get(ohtId)
      if (spr) {
        spr.halo.tint = 0x06b6d4
        spr.halo.alpha = 0.55
        spr.halo.scale.set(1.3)
        this.ohtTopLayer?.addChild(spr.container)
        this.selectedTarget = spr.container
      }
    }
  }

  private getOrCreateOhtSprite(oht: OhtInfo) {
    let spr = this.ohtSprites.get(oht.id)
    if (spr) return spr

    const container = new PIXI.Container()
    ;(container as any)._ohtId = oht.id

    const halo = new PIXI.Graphics()
    halo.beginFill(0xffffff, 0)
    halo.drawCircle(0, 0, 18)
    halo.endFill()
    halo.alpha = 0

    const body = new PIXI.Graphics()
    body.lineStyle(1, 0x000000, 0.7)
    body.beginFill(0xffffff, 1)
    body.drawRoundedRect(-11, -7, 22, 14, 3)
    body.endFill()
    body.lineStyle(1, 0xffffff, 0.8)
    body.beginFill(0xffffff, 0.25)
    body.drawRoundedRect(-9, -5, 18, 3, 1.5)
    body.endFill()

    const directionArrow = new PIXI.Graphics()
    directionArrow.beginFill(0xffffff, 0.9)
    directionArrow.moveTo(8, 0)
    directionArrow.lineTo(4, -3.5)
    directionArrow.lineTo(4, 3.5)
    directionArrow.closePath()
    directionArrow.endFill()

    const foupIndicator = new PIXI.Graphics()

    const label = new PIXI.Text(oht.id.replace('OHT-', ''), {
      fontFamily: 'Consolas, monospace',
      fontSize: 8,
      fill: 0xffffff,
      align: 'center',
      fontWeight: '700',
      stroke: 0x000000,
      strokeThickness: 2,
    })
    label.anchor.set(0.5, 2.1)
    label.resolution = 2

    container.addChild(halo)
    container.addChild(body)
    container.addChild(directionArrow)
    container.addChild(foupIndicator)
    container.addChild(label)

    spr = { body, directionArrow, foupIndicator, halo, label, container }
    this.ohtSprites.set(oht.id, spr)
    this.ohtLayer?.addChild(container)
    return spr
  }

  private parseColor(hex: string): number {
    if (hex.startsWith('hsl')) return 0x888888
    let h = hex.replace('#', '')
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return parseInt(h, 16) || 0x888888
  }

  private foupColor(state: FoupState): number {
    switch (state) {
      case 'LOADED':
        return 0x10b981
      case 'PICKING':
        return 0xf59e0b
      case 'PLACING':
        return 0x8b5cf6
      default:
        return 0x475569
    }
  }

  private renderOht(oht: OhtInfo) {
    const spr = this.getOrCreateOhtSprite(oht)
    const color = this.parseColor(oht.color)
    const displayX = oht.displayX ?? oht.x
    const displayY = oht.displayY ?? oht.y

    spr.container.x = displayX
    spr.container.y = displayY

    spr.body.clear()
    spr.body.lineStyle(1, 0x000000, 0.7)
    spr.body.beginFill(color, 1)
    spr.body.drawRoundedRect(-11, -7, 22, 14, 3)
    spr.body.endFill()
    spr.body.lineStyle(1, 0xffffff, 0.4)
    spr.body.beginFill(0xffffff, 0.3)
    spr.body.drawRoundedRect(-9, -5, 18, 3, 1.5)
    spr.body.endFill()

    spr.container.rotation = (oht.direction * Math.PI) / 180

    spr.foupIndicator.clear()
    const fc = this.foupColor(oht.foupState)
    spr.foupIndicator.beginFill(fc, 0.9)
    spr.foupIndicator.lineStyle(1, 0x000000, 0.5)
    spr.foupIndicator.drawRoundedRect(-4, -5, 8, 4, 1)
    spr.foupIndicator.endFill()

    if (oht.status === 'BLOCKED') {
      spr.body.lineStyle(2, 0xef4444, 1)
      spr.body.beginFill(color, 0.5)
      spr.body.drawRoundedRect(-11, -7, 22, 14, 3)
      spr.body.endFill()
    }
  }

  private cleanupStaleOhts(aliveIds: Set<string>) {
    for (const [id, spr] of this.ohtSprites) {
      if (!aliveIds.has(id)) {
        spr.container.destroy({ children: true })
        this.ohtSprites.delete(id)
      }
    }
  }

  private startRenderLoop() {
    const tick = (time: number) => {
      const dt = this.lastFrameTime ? time - this.lastFrameTime : 16
      this.lastFrameTime = time

      this.interpolationFactor = Math.min(1, dt / 50)
      this.store.updateDisplayPositions(this.interpolationFactor)

      const ohts = this.store.allOhts
      const aliveIds = new Set<string>()

      for (const oht of ohts) {
        this.renderOht(oht)
        aliveIds.add(oht.id)
      }

      this.cleanupStaleOhts(aliveIds)

      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  getViewport(): RendererViewport {
    return { ...this.viewport }
  }

  getWorldAt(sx: number, sy: number): { gridX: number; gridY: number } | null {
    if (!this.dims) return null
    const { x: wx, y: wy } = this.screenToWorld(sx, sy)
    return {
      gridX: Math.floor(wx / this.dims.cellSize),
      gridY: Math.floor(wy / this.dims.cellSize),
    }
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    window.removeEventListener('resize', this.handleResize)
    this.app?.destroy(true, { children: true, texture: true, baseTexture: true })
    this.app = null
  }
}
