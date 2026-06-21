<template>
  <div class="app-root">
    <header class="app-header">
      <div class="header-title">
        <svg width="26" height="26" viewBox="0 0 40 40" fill="none">
          <rect x="3" y="3" width="34" height="34" rx="6" stroke="url(#g1)" stroke-width="2"/>
          <path d="M12 28 L20 12 L28 28 Z" fill="url(#g1)" opacity="0.8"/>
          <circle cx="20" cy="22" r="3" fill="#0a0e1a"/>
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="40" y2="40">
              <stop offset="0" stop-color="#06b6d4"/>
              <stop offset="1" stop-color="#3b82f6"/>
            </linearGradient>
          </defs>
        </svg>
        <h1>OHT Dispatcher &middot; 300mm Fab Traffic Control Center</h1>
      </div>
      <div style="display: flex; align-items: center; gap: 14px;">
        <span class="status-pill" :class="store.isConnected ? 'connected' : 'disconnected'">
          <span class="dot"></span>
          {{ store.isConnected ? 'WebSocket 已连接' : 'WebSocket 未连接' }}
        </span>
        <div style="font-family: Consolas, monospace; font-size: 12px; color: var(--text-secondary);">
          帧率: <span style="color: var(--accent-cyan); font-weight: 700;">{{ store.avgFps }}</span> FPS
          &nbsp;|&nbsp;
          序列: <span style="color: var(--accent-blue); font-weight: 700;">#{{ store.latestSequence }}</span>
        </div>
      </div>
    </header>

    <div class="app-main">
      <div ref="canvasContainerRef" class="canvas-container" @contextmenu.prevent>
        <div v-if="!store.grid" style="
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); font-size: 14px;
        ">
          <div style="text-align: center;">
            <div style="margin-bottom: 12px;">
              <div style="width: 40px; height: 40px; border: 3px solid var(--accent-blue);
                border-top-color: transparent; border-radius: 50%;
                animation: spin 0.8s linear infinite; margin: 0 auto;"></div>
            </div>
            <div>正在连接 OHT 调度中枢...</div>
          </div>
        </div>

        <div v-if="tooltipVisible" class="overlay-tooltip" :style="tooltipStyle">
          <div class="tt-title">
            <span class="oht-color-dot" :style="{ background: hoveredOht?.color }"></span>
            {{ hoveredOht?.id }}
            <span class="oht-badge" :class="hoveredOht?.status">{{ hoveredOht?.status }}</span>
          </div>
          <div class="tt-row"><span class="k">坐标 (X, Y)</span><span class="v">({{ displayPos(hoveredOht) }})</span></div>
          <div class="tt-row"><span class="k">网格 (GX, GY)</span><span class="v">({{ hoveredOht?.gridX }}, {{ hoveredOht?.gridY }})</span></div>
          <div class="tt-row"><span class="k">运行速度</span><span class="v">{{ formatSpeed(hoveredOht?.speed) }} m/s</span></div>
          <div class="tt-row"><span class="k">运行方向</span><span class="v">{{ hoveredOht?.direction }}°</span></div>
          <div class="tt-row"><span class="k">FOUP 状态</span>
            <span class="v">
              <span class="foup-dot" :class="foupClass(hoveredOht?.foupState)"></span>
              {{ hoveredOht?.foupState }}
            </span>
          </div>
          <div class="tt-row" v-if="hoveredOht?.foupId">
            <span class="k">FOUP 编号</span><span class="v">{{ hoveredOht.foupId }}</span>
          </div>
        </div>

        <div class="legend">
          <div class="legend-title">Fab 地图图例</div>
          <div class="legend-item">
            <span class="legend-color" style="background: #059669;"></span>
            <span>装卸站 (Stations)</span>
          </div>
          <div class="legend-item">
            <span class="legend-color" style="background: #d97706;"></span>
            <span>交叉路口 (Intersections)</span>
          </div>
          <div class="legend-item">
            <span class="legend-color" style="background: #0891b2;"></span>
            <span>缓冲区 (Buffer Zone)</span>
          </div>
          <div class="legend-item">
            <span class="legend-color" style="background: #7f1d1d;"></span>
            <span>禁行区 (Blocked)</span>
          </div>
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color);">
            <div class="legend-item">
              <span class="foup-dot loaded"></span>
              <span>载具已装载 (LOADED)</span>
            </div>
            <div class="legend-item">
              <span class="foup-dot empty"></span>
              <span>载具空载 (EMPTY)</span>
            </div>
          </div>
        </div>

        <div class="zoom-controls">
          <button class="zoom-btn" @click="zoomIn" title="放大">+</button>
          <button class="zoom-btn" @click="zoomOut" title="缩小">−</button>
          <button class="zoom-btn" @click="resetView" title="重置视图" style="font-size: 13px;">⤢</button>
        </div>
      </div>

      <aside class="sidebar">
        <div class="sidebar-section">
          <div class="section-title">
            <span>系统概览</span>
          </div>
          <div class="stat-grid">
            <div class="stat-card">
              <div class="stat-label">天车总数</div>
              <div class="stat-value cyan">{{ store.ohtCount }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">运行中</div>
              <div class="stat-value blue">{{ store.movingCount }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">FOUP 在运</div>
              <div class="stat-value green">{{ store.loadedFoupCount }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">帧接收</div>
              <div class="stat-value amber">{{ store.framesReceived }}</div>
            </div>
          </div>
        </div>

        <div class="sidebar-section" v-if="store.status">
          <div class="section-title">
            <span>调度中枢指标</span>
          </div>
          <div class="metric-bar">
            <span class="label">TCP 设备连接</span>
            <span class="value">{{ store.status.activeConnections }}</span>
          </div>
          <div class="metric-bar">
            <span class="label">路由成功率</span>
            <span class="value" style="color: var(--accent-green);">{{ store.status.routing.successRate }}</span>
          </div>
          <div class="metric-bar">
            <span class="label">平均路径长度</span>
            <span class="value">{{ store.status.routing.avgPathLength }} 段</span>
          </div>
          <div class="metric-bar">
            <span class="label">避障次数</span>
            <span class="value" style="color: var(--accent-purple);">{{ store.status.routing.collisionAvoidances }}</span>
          </div>
          <div class="metric-bar">
            <span class="label">路网占用率</span>
            <span class="value" :style="occupancyStyle">
              {{ occupancyRate }}%
            </span>
          </div>
          <div class="metric-bar">
            <span class="label">交叉路口告警</span>
            <span class="value" style="color: var(--accent-amber);">{{ store.status.metrics.collisionWarnings }}</span>
          </div>
        </div>

        <div class="sidebar-section" v-if="store.selectedOht">
          <div class="section-title">
            <span>天车详情</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
            <span class="oht-color-dot" :style="{ background: store.selectedOht.color, width: 16, height: 16, borderRadius: 4 }"></span>
            <div>
              <div style="font-family: Consolas, monospace; font-weight: 700; font-size: 14px;">{{ store.selectedOht.id }}</div>
              <div style="margin-top: 2px;">
                <span class="oht-badge" :class="store.selectedOht.status">{{ store.selectedOht.status }}</span>
              </div>
            </div>
          </div>
          <div class="metric-bar">
            <span class="label">当前位置</span>
            <span class="value">({{ store.selectedOht.gridX }}, {{ store.selectedOht.gridY }})</span>
          </div>
          <div class="metric-bar">
            <span class="label">运行速度</span>
            <span class="value">{{ formatSpeed(store.selectedOht.speed) }} m/s</span>
          </div>
          <div class="metric-bar">
            <span class="label">行驶方向</span>
            <span class="value">{{ store.selectedOht.direction }}°</span>
          </div>
          <div class="metric-bar">
            <span class="label">FOUP 状态</span>
            <span class="value">
              <span class="foup-dot" :class="foupClass(store.selectedOht.foupState)"></span>
              {{ store.selectedOht.foupState }}
            </span>
          </div>
          <div class="metric-bar" v-if="store.selectedOht.foupId">
            <span class="label">FOUP 编号</span>
            <span class="value">{{ store.selectedOht.foupId }}</span>
          </div>
        </div>

        <div class="sidebar-section" style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
          <div class="section-title">
            <span>天车列表</span>
            <span style="color: var(--accent-cyan); font-weight: 700; text-transform: none;">{{ store.ohtCount }}</span>
          </div>
          <div class="oht-list" style="overflow-y: auto; flex: 1;">
            <div
              v-for="oht in sortedOhts"
              :key="oht.id"
              class="oht-item"
              :class="{ selected: store.selectedOhtId === oht.id }"
              @click="selectOht(oht.id)"
              @mouseenter="hoverOht(oht.id)"
              @mouseleave="hoverOht(null)"
            >
              <span class="oht-color-dot" :style="{ background: oht.color }"></span>
              <div class="oht-item-info">
                <div class="oht-id">{{ oht.id }}</div>
                <div class="oht-meta">
                  <span>({{ oht.gridX }}, {{ oht.gridY }})</span>
                  <span>{{ formatSpeed(oht.speed) }}</span>
                  <span>
                    <span class="foup-dot" :class="foupClass(oht.foupState)"></span>
                    {{ oht.foupState === 'LOADED' ? '装载' : '空载' }}
                  </span>
                </div>
              </div>
              <span class="oht-badge" :class="oht.status">
                {{ oht.status === 'MOVING' ? '运行' : oht.status === 'IDLE' ? '空闲' : oht.status }}
              </span>
            </div>
            <div v-if="store.ohtCount === 0" style="
              padding: 20px; text-align: center;
              color: var(--text-muted); font-size: 12px;
            ">
              等待天车连接...
            </div>
          </div>
        </div>
      </aside>
    </div>

    <style>
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useOhtStore } from './store/ohtStore'
import { OhtWsClient } from './services/wsClient'
import { FabMapRenderer } from './renderer/FabMapRenderer'
import type { OhtInfo, FoupState } from './types'

const store = useOhtStore()
const canvasContainerRef = ref<HTMLElement | null>(null)

let renderer: FabMapRenderer | null = null
let wsClient: OhtWsClient | null = null

const tooltipVisible = ref(false)
const tooltipX = ref(0)
const tooltipY = ref(0)
const hoveredOht = ref<OhtInfo | null>(null)

const sortedOhts = computed(() => {
  return [...store.allOhts].sort((a, b) => {
    if (a.status === 'MOVING' && b.status !== 'MOVING') return -1
    if (b.status === 'MOVING' && a.status !== 'MOVING') return 1
    return a.id.localeCompare(b.id)
  })
})

const occupancyRate = computed(() => {
  if (!store.status) return 0
  const { totalCells, occupiedCells } = store.status.metrics
  return totalCells > 0 ? ((occupiedCells / totalCells) * 100).toFixed(1) : 0
})

const occupancyStyle = computed(() => {
  const rate = parseFloat(occupancyRate.value as string)
  if (rate > 30) return { color: 'var(--accent-red)' }
  if (rate > 15) return { color: 'var(--accent-amber)' }
  return { color: 'var(--accent-green)' }
})

const tooltipStyle = computed(() => ({
  left: `${tooltipX.value + 16}px`,
  top: `${tooltipY.value + 12}px`,
}))

function formatSpeed(s?: number): string {
  if (s === undefined || s === null) return '0.00'
  return s.toFixed(2)
}

function foupClass(f?: FoupState): string {
  return f === 'LOADED' || f === 'PICKING' || f === 'PLACING' ? 'loaded' : 'empty'
}

function displayPos(o?: OhtInfo): string {
  if (!o) return '-, -'
  const x = (o.displayX ?? o.x).toFixed(1)
  const y = (o.displayY ?? o.y).toFixed(1)
  return `${x}, ${y}`
}

function handleOhtClick(id: string) {
  // Store already syncs via renderer callback
}

function hoverOht(id: string | null) {
  if (!id) {
    hoveredOht.value = null
    tooltipVisible.value = false
    return
  }
  const oht = store.getOht(id)
  if (oht && renderer) {
    hoveredOht.value = oht
    const vp = renderer.getViewport()
    if (canvasContainerRef.value) {
      const rect = canvasContainerRef.value.getBoundingClientRect()
      tooltipX.value = (oht.displayX ?? oht.x) * vp.scale + vp.offsetX
      tooltipY.value = (oht.displayY ?? oht.y) * vp.scale + vp.offsetY
      tooltipVisible.value = true
      const maxX = rect.width - 220
      const maxY = rect.height - 180
      if (tooltipX.value > maxX) tooltipX.value = maxX
      if (tooltipY.value > maxY) tooltipY.value = maxY
    }
  }
}

function selectOht(id: string) {
  store.setSelectedOht(store.selectedOhtId === id ? null : id)
  renderer?.setSelectedOht(store.selectedOhtId)
}

function zoomIn() {
  renderer?.zoom(1.2)
}
function zoomOut() {
  renderer?.zoom(1 / 1.2)
}
function resetView() {
  renderer?.resetView()
}

watch(
  () => store.grid,
  async (g) => {
    if (g && renderer) {
      await nextTick()
      renderer.buildMap(g, store.stations, store.specialCells)
    }
  },
)

watch(
  () => store._selectedOhtId,
  (id) => {
    renderer?.setSelectedOht(id as any)
  },
)

let tooltipInterval: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await nextTick()
  if (canvasContainerRef.value) {
    renderer = new FabMapRenderer(canvasContainerRef.value, store as any)
    renderer.setCallbacks({
      onOhtClick: (id) => {
        store.setSelectedOht(store.selectedOhtId === id ? null : id)
        handleOhtClick(id)
      },
      onOhtHover: (id) => {
        if (!id) {
          hoveredOht.value = null
          tooltipVisible.value = false
        } else {
          hoverOht(id)
        }
      },
    })
    await renderer.init()

    if (store.grid) {
      renderer.buildMap(store.grid, store.stations, store.specialCells)
    }
  }

  wsClient = new OhtWsClient(store as any)
  wsClient.connect('http://localhost:3000')

  tooltipInterval = setInterval(() => {
    if (hoveredOht.value && renderer && canvasContainerRef.value) {
      const oht = store.getOht(hoveredOht.value.id)
      if (oht) {
        hoveredOht.value = oht
        const vp = renderer.getViewport()
        const rect = canvasContainerRef.value.getBoundingClientRect()
        tooltipX.value = (oht.displayX ?? oht.x) * vp.scale + vp.offsetX
        tooltipY.value = (oht.displayY ?? oht.y) * vp.scale + vp.offsetY
        const maxX = rect.width - 220
        const maxY = rect.height - 180
        if (tooltipX.value > maxX) tooltipX.value = maxX
        if (tooltipY.value > maxY) tooltipY.value = maxY
      }
    }
  }, 50)
})

onUnmounted(() => {
  if (tooltipInterval) clearInterval(tooltipInterval)
  wsClient?.disconnect()
  renderer?.destroy()
})
</script>
