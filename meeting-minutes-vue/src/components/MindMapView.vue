<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use } from 'echarts/core'
import { TreeChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { useStore } from '../composables/useStore'

use([TreeChart, TooltipComponent, SVGRenderer])

const store = useStore()
const chartElement = ref(null)
const allCollapsed = ref(false)
let chart = null
let resizeObserver = null

const COLORS = ['#4f6df5', '#14a779', '#f59e0b', '#e85d4a', '#8b5cf6', '#0891b2', '#db5594', '#64748b']

function colorFromText(text) {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) hash = text.charCodeAt(i) + ((hash << 5) - hash)
  return COLORS[Math.abs(hash) % COLORS.length]
}

function shortText(text, length = 42) {
  const value = (text || '').trim()
  return value.length > length ? `${value.slice(0, length)}…` : value
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const groupedTopics = computed(() => {
  const groups = new Map()
  store.entries.value.forEach((entry) => {
    const topic = entry.topic?.trim() || '未分类'
    if (!groups.has(topic)) groups.set(topic, [])
    groups.get(topic).push(entry)
  })
  return [...groups.entries()]
    .map(([name, entries]) => ({ name, entries: [...entries].sort((a, b) => a.time.localeCompare(b.time)) }))
    .sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name, 'zh-CN'))
})

const speakerCount = computed(() => new Set(store.entries.value.map((entry) => entry.speakerId).filter(Boolean)).size)

const treeData = computed(() => ({
  name: store.meeting.value.title || '未命名会议',
  kind: 'root',
  count: store.entries.value.length,
  symbol: 'roundRect',
  symbolSize: [18, 18],
  itemStyle: { color: '#4f6df5', borderColor: '#dce3ff', borderWidth: 6 },
  label: {
    color: '#fff', backgroundColor: '#4f6df5', borderRadius: 9,
    padding: [10, 15], fontSize: 14, fontWeight: 700,
  },
  children: groupedTopics.value.map((topic) => {
    const color = colorFromText(topic.name)
    return {
      name: topic.name,
      kind: 'topic',
      count: topic.entries.length,
      collapsed: allCollapsed.value,
      symbol: 'circle',
      symbolSize: 11,
      itemStyle: { color, borderColor: '#fff', borderWidth: 2 },
      lineStyle: { color, width: 1.8 },
      label: {
        color: '#fff', backgroundColor: color, borderRadius: 7,
        padding: [7, 11], fontSize: 12, fontWeight: 600,
      },
      children: topic.entries.map((entry) => {
        const speaker = store.getPerson(entry.speakerId)
        const time = entry.time?.split(' ').pop() || '未设置时间'
        const meta = `${time}${speaker ? ` · ${speaker.name}` : ' · 会议记录'}`
        return {
          name: `${meta}\n${shortText(entry.content)}`,
          kind: 'entry',
          raw: { content: entry.content, time, speaker: speaker?.name || '会议记录', topic: topic.name },
          symbol: 'circle',
          symbolSize: 7,
          itemStyle: { color: '#fff', borderColor: color, borderWidth: 2 },
          label: {
            color: '#364152', backgroundColor: '#fff', borderColor: '#dfe3eb', borderWidth: 1,
            borderRadius: 7, padding: [7, 10], fontSize: 11, lineHeight: 18,
            shadowColor: 'rgba(31,35,41,.06)', shadowBlur: 7, shadowOffsetY: 2,
          },
        }
      }),
    }
  }),
}))

function tooltipFormatter(params) {
  const data = params.data
  if (data.kind === 'root') {
    return `<strong>${escapeHtml(data.name)}</strong><br/><span style="color:#8f959e">${data.count} 条会议记录</span>`
  }
  if (data.kind === 'topic') {
    return `<strong>${escapeHtml(data.name)}</strong><br/><span style="color:#8f959e">${data.count} 条相关记录</span>`
  }
  const raw = data.raw || {}
  return `<div style="max-width:320px;line-height:1.65"><strong>${escapeHtml(raw.topic)}</strong><br/>${escapeHtml(raw.content)}<br/><span style="color:#8f959e">${escapeHtml(raw.time)} · ${escapeHtml(raw.speaker)}</span></div>`
}

function chartOption() {
  const compact = (chartElement.value?.clientWidth || 900) < 720
  return {
    animationDuration: 350,
    animationDurationUpdate: 450,
    tooltip: {
      trigger: 'item', triggerOn: 'mousemove', confine: true,
      backgroundColor: 'rgba(255,255,255,.98)', borderColor: '#e5e7eb', borderWidth: 1,
      padding: [10, 12], textStyle: { color: '#1f2329', fontSize: 12 },
      extraCssText: 'box-shadow:0 10px 30px rgba(31,35,41,.12);border-radius:8px;',
      formatter: tooltipFormatter,
    },
    series: [{
      type: 'tree',
      data: [treeData.value],
      orient: 'LR',
      left: compact ? '4%' : '5%',
      right: compact ? '52%' : '34%',
      top: '7%',
      bottom: '7%',
      roam: true,
      scaleLimit: { min: 0.45, max: 2.2 },
      initialTreeDepth: -1,
      expandAndCollapse: true,
      edgeShape: 'curve',
      edgeForkPosition: '55%',
      symbol: 'circle',
      symbolSize: 8,
      lineStyle: { color: '#cdd3df', width: 1.5, curveness: 0.5 },
      emphasis: { focus: 'descendant' },
      label: { position: 'right', verticalAlign: 'middle', align: 'left', distance: 10 },
      leaves: { label: { position: 'right', verticalAlign: 'middle', align: 'left', distance: 9 } },
    }],
  }
}

async function renderChart(reset = false) {
  await nextTick()
  if (!chartElement.value || !store.entries.value.length) return
  if (!chart) chart = init(chartElement.value, null, { renderer: 'svg' })
  if (reset) chart.clear()
  chart.setOption(chartOption(), { notMerge: true })
}

function toggleAll() {
  allCollapsed.value = !allCollapsed.value
  renderChart(true)
}

function resetView() {
  renderChart(true)
}

watch(treeData, () => renderChart(true), { deep: true })

onMounted(() => {
  renderChart()
  resizeObserver = new ResizeObserver(() => chart?.resize())
  if (chartElement.value) resizeObserver.observe(chartElement.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})
</script>

<template>
  <section class="mindmap-view">
    <div class="mindmap-toolbar">
      <div>
        <h3>会议脉络</h3>
        <p>以主题为主干，展开全部会议记录</p>
      </div>
      <div v-if="store.entries.value.length" class="toolbar-actions">
        <button class="tree-action" @click="toggleAll">
          <SvgIcon :name="allCollapsed ? 'chevron-right' : 'list-checks'" :size="14" />
          {{ allCollapsed ? '展开全部' : '收起主题' }}
        </button>
        <button class="tree-action" @click="resetView">
          <SvgIcon name="target" :size="14" /> 重置视图
        </button>
      </div>
    </div>

    <div v-if="store.entries.value.length" class="mindmap-card">
      <div ref="chartElement" class="mindmap-chart" role="img" :aria-label="`${store.meeting.value.title || '会议'}的树形思维导图`"></div>
      <div class="mindmap-status">
        <div class="mindmap-stats">
          <span><strong>{{ groupedTopics.length }}</strong> 个主题</span>
          <span><strong>{{ store.entries.value.length }}</strong> 条记录</span>
          <span><strong>{{ speakerCount }}</strong> 位发言人</span>
        </div>
        <div class="interaction-hint">
          <span>滚轮缩放</span><i></i><span>拖动画布</span><i></i><span>点击主题收起/展开</span>
        </div>
      </div>
    </div>

    <div v-else class="mindmap-empty">
      <div class="empty-illustration"><SvgIcon name="git-branch" :size="29" /></div>
      <h4>还没有可展示的会议脉络</h4>
      <p>添加会议记录并设置主题后，这里会自动生成树形思维导图。</p>
    </div>
  </section>
</template>

<style scoped>
.mindmap-view { width: 100%; max-width: 1220px; margin: 0 auto; }
.mindmap-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 12px; }
.mindmap-toolbar h3 { font-size: .98rem; line-height: 1.4; }
.mindmap-toolbar p { margin-top: 2px; color: var(--text-muted); font-size: .76rem; }
.toolbar-actions { display: flex; gap: 7px; }
.tree-action { display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 7px; color: var(--text-secondary); background: var(--surface); font-size: .76rem; transition: var(--transition); }
.tree-action:hover { color: var(--primary); border-color: #cdd7ff; background: var(--primary-light); }
.mindmap-card { overflow: hidden; border: 1px solid var(--border-light); border-radius: 12px; background: radial-gradient(circle at 10% 12%, #f5f7ff 0, #fff 31%); box-shadow: var(--shadow-sm); }
.mindmap-chart { width: 100%; height: min(62vh, 590px); min-height: 470px; }
.mindmap-status { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 9px 14px; border-top: 1px solid var(--border-light); color: var(--text-muted); background: rgba(250,251,253,.92); font-size: .72rem; }
.mindmap-stats { display: flex; gap: 17px; }
.mindmap-stats strong { color: var(--text); font-size: .8rem; }
.interaction-hint { display: flex; align-items: center; gap: 7px; }
.interaction-hint i { width: 3px; height: 3px; border-radius: 50%; background: #c1c6cf; }
.mindmap-empty { min-height: 390px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed #d9deea; border-radius: 12px; color: var(--text-muted); background: rgba(255,255,255,.72); }
.empty-illustration { width: 62px; height: 62px; display: grid; place-items: center; margin-bottom: 14px; border-radius: 18px; color: var(--primary); background: var(--primary-light); }
.mindmap-empty h4 { margin-bottom: 5px; color: var(--text-secondary); font-size: .92rem; }
.mindmap-empty p { font-size: .78rem; }
@media (max-width: 760px) {
  .mindmap-toolbar, .mindmap-status { align-items: flex-start; flex-direction: column; }
  .mindmap-chart { min-height: 500px; }
  .interaction-hint { flex-wrap: wrap; }
}
</style>
