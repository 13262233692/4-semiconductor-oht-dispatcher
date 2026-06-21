import { io, Socket } from 'socket.io-client'
import type { SystemInit, SystemStatus, SpatioTemporalFrame } from '../types'
import { useOhtStore } from '../store/ohtStore'

export class OhtWsClient {
  private socket: Socket | null = null
  private store: ReturnType<typeof useOhtStore>
  private reconnectAttempts = 0
  private maxReconnectDelay = 10000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(store: ReturnType<typeof useOhtStore>) {
    this.store = store
  }

  connect(url: string = 'http://localhost:3000') {
    if (this.socket?.connected) return

    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: this.maxReconnectDelay,
      timeout: 10000,
    })

    this.socket.on('connect', () => {
      console.log('[WS] Connected to OHT Dispatcher')
      this.reconnectAttempts = 0
      this.store.setConnected(true)
    })

    this.socket.on('disconnect', (reason) => {
      console.warn(`[WS] Disconnected: ${reason}`)
      this.store.setConnected(false)
    })

    this.socket.on('connect_error', (err) => {
      console.error(`[WS] Connect error: ${err.message}`)
      this.reconnectAttempts++
      this.store.setError(err.message)
    })

    this.socket.on('system:init', (init: SystemInit) => {
      console.log('[WS] Received system:init, grid:', init.grid)
      this.store.applyInit(init)
    })

    this.socket.on('frame:update', (frame: SpatioTemporalFrame) => {
      this.store.applyFrame(frame)
    })

    this.socket.on('frame:snapshot', (frame: SpatioTemporalFrame) => {
      this.store.applyFrame(frame)
    })

    this.socket.on('system:status', (status: SystemStatus) => {
      this.store.applyStatus(status)
    })

    this.socket.on('oht:event', (event: any) => {
      // console.log('[WS] Event:', event)
    })

    this.socket.on('control:ohtList', (list: any[]) => {
      console.log('[WS] OHT list:', list.length)
    })

    this.socket.on('control:routeAssigned', (resp: any) => {
      console.log('[WS] Route assigned:', resp)
    })
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.store.setConnected(false)
  }

  assignRoute(ohtId: string, targetX: number, targetY: number) {
    this.socket?.emit('control:assignRoute', { ohtId, targetX, targetY })
  }

  requestOhtList() {
    this.socket?.emit('control:getOhtList')
  }

  requestGridMap() {
    this.socket?.emit('control:getGridMap')
  }

  requestSnapshot() {
    this.socket?.emit('control:requestSnapshot')
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false
  }
}
