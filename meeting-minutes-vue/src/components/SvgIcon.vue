<script>
import { h } from 'vue'

/**
 * SvgIcon - Inline SVG icon component (Lucide/Feather style, 24x24, stroke-based)
 *
 * Usage:  <SvgIcon name="home" :size="18" />
 *         <SvgIcon name="clock" :size="14" :stroke-width="1.5" />
 *
 * All icons use currentColor for stroke, inheriting text color.
 * Register globally so no per-component import needed.
 */
const ICONS = {
  microphone: [
    ['path', { d: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z' }],
    ['path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }],
    ['line', { x1: 12, y1: 19, x2: 12, y2: 22 }],
    ['line', { x1: 8, y1: 22, x2: 16, y2: 22 }]
  ],
  'edit-3': [
    ['path', { d: 'M12 20h9' }],
    ['path', { d: 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z' }]
  ],
  home: [
    ['path', { d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }],
    ['polyline', { points: '9 22 9 12 15 12 15 22' }]
  ],
  file: [
    ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
    ['polyline', { points: '14 2 14 8 20 8' }]
  ],
  'file-text': [
    ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
    ['polyline', { points: '14 2 14 8 20 8' }],
    ['line', { x1: 16, y1: 13, x2: 8, y2: 13 }],
    ['line', { x1: 16, y1: 17, x2: 8, y2: 17 }],
    ['line', { x1: 10, y1: 9, x2: 8, y2: 9 }]
  ],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }]
  ],
  star: [
    ['polygon', { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' }]
  ],
  trash: [
    ['polyline', { points: '3 6 5 6 21 6' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }]
  ],
  clipboard: [
    ['rect', { x: 8, y: 2, width: 8, height: 4, rx: 1, ry: 1 }],
    ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }]
  ],
  tag: [
    ['path', { d: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z' }],
    ['line', { x1: 7, y1: 7, x2: 7.01, y2: 7 }]
  ],
  users: [
    ['path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }],
    ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }]
  ],
  user: [
    ['path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 12, cy: 7, r: 4 }]
  ],
  sparkles: [
    ['path', { d: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z' }],
    ['path', { d: 'M20 3v4' }],
    ['path', { d: 'M22 5h-4' }],
    ['path', { d: 'M4 17v2' }],
    ['path', { d: 'M5 18H3' }]
  ],
  'check-circle': [
    ['path', { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' }],
    ['polyline', { points: '22 4 12 14.01 9 11.01' }]
  ],
  'check-square': [
    ['polyline', { points: '9 11 12 14 22 4' }],
    ['path', { d: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' }]
  ],
  paperclip: [
    ['path', { d: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' }]
  ],
  settings: [
    ['path', { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }]
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['polyline', { points: '12 6 12 12 16 14' }]
  ],
  calendar: [
    ['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, ry: 2 }],
    ['line', { x1: 16, y1: 2, x2: 16, y2: 6 }],
    ['line', { x1: 8, y1: 2, x2: 8, y2: 6 }],
    ['line', { x1: 3, y1: 10, x2: 21, y2: 10 }]
  ],
  'map-pin': [
    ['path', { d: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' }],
    ['circle', { cx: 12, cy: 10, r: 3 }]
  ],
  lightbulb: [
    ['path', { d: 'M9 18h6' }],
    ['path', { d: 'M10 22h4' }],
    ['path', { d: 'M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14' }]
  ],
  'git-branch': [
    ['line', { x1: 6, y1: 3, x2: 6, y2: 15 }],
    ['circle', { cx: 18, cy: 6, r: 3 }],
    ['circle', { cx: 6, cy: 18, r: 3 }],
    ['path', { d: 'M18 9a9 9 0 0 1-9 9' }]
  ],
  target: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['circle', { cx: 12, cy: 12, r: 6 }],
    ['circle', { cx: 12, cy: 12, r: 2 }]
  ],
  key: [
    ['circle', { cx: 8, cy: 15, r: 4 }],
    ['path', { d: 'M10.85 12.15 19 4' }],
    ['path', { d: 'M18 5l2 2' }],
    ['path', { d: 'M15 8l2 2' }]
  ],
  'list-checks': [
    ['path', { d: 'M3 17l2 2 4-4' }],
    ['path', { d: 'M3 7l2 2 4-4' }],
    ['path', { d: 'M13 6h8' }],
    ['path', { d: 'M13 12h8' }],
    ['path', { d: 'M13 18h8' }]
  ],
  close: [
    ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }],
    ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]
  ],
  'panel-right': [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }],
    ['line', { x1: 15, y1: 3, x2: 15, y2: 21 }]
  ],
  'chevron-right': [
    ['polyline', { points: '9 18 15 12 9 6' }]
  ],
  'chevron-up': [
    ['polyline', { points: '18 15 12 9 6 15' }]
  ],
  'log-out': [
    ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
    ['polyline', { points: '16 17 21 12 16 7' }],
    ['line', { x1: 21, y1: 12, x2: 9, y2: 12 }]
  ],
  download: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points: '7 10 12 15 17 10' }],
    ['line', { x1: 12, y1: 15, x2: 12, y2: 3 }]
  ],
  share: [
    ['circle', { cx: 18, cy: 5, r: 3 }],
    ['circle', { cx: 6, cy: 12, r: 3 }],
    ['circle', { cx: 18, cy: 19, r: 3 }],
    ['line', { x1: 8.59, y1: 13.51, x2: 15.42, y2: 17.49 }],
    ['line', { x1: 15.41, y1: 6.51, x2: 8.59, y2: 10.49 }]
  ],
  'more-horizontal': [
    ['circle', { cx: 5, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 12, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 19, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }]
  ]
}

export default {
  name: 'SvgIcon',
  props: {
    name: { type: String, required: true },
    size: { type: [Number, String], default: 16 },
    strokeWidth: { type: [Number, String], default: 2 }
  },
  render() {
    const data = ICONS[this.name]
    if (!data) return null
    return h('svg', {
      width: this.size,
      height: this.size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': this.strokeWidth,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: 'svg-icon',
      'aria-hidden': 'true'
    }, data.map(([tag, attrs]) => h(tag, attrs)))
  }
}
</script>
