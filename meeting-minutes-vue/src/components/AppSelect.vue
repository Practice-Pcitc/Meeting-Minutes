<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择' },
  allowCustom: Boolean,
  clearable: { type: Boolean, default: true },
  disabled: Boolean,
})
const emit = defineEmits(['update:modelValue'])
const trigger = ref(null)
const input = ref(null)
const open = ref(false)
const query = ref('')
const position = ref({ top: '0px', left: '0px', width: '220px' })
const selected = computed(() => props.options.find((option) => option.value === props.modelValue))
const displayText = computed(() => selected.value?.label || (props.allowCustom ? String(props.modelValue || '') : ''))
const filtered = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return keyword ? props.options.filter((option) => option.label.toLocaleLowerCase().includes(keyword)) : props.options
})
const canUseCustom = computed(() => props.allowCustom && query.value.trim() && !props.options.some((option) => option.label.toLocaleLowerCase() === query.value.trim().toLocaleLowerCase()))

watch(() => props.modelValue, () => { if (!open.value) query.value = displayText.value })

async function show() {
  if (props.disabled || open.value) return
  open.value = true
  query.value = displayText.value
  await nextTick()
  updatePosition()
  input.value?.select()
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
}
function close() {
  open.value = false
  query.value = displayText.value
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
}
function updatePosition() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.max(rect.width, 220)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
  const estimatedHeight = Math.min(300, 48 + Math.max(filtered.value.length, 1) * 42)
  const top = window.innerHeight - rect.bottom >= estimatedHeight || rect.top < estimatedHeight ? rect.bottom + 7 : rect.top - estimatedHeight - 7
  position.value = { left: `${left}px`, top: `${Math.max(12, top)}px`, width: `${width}px` }
}
function choose(value) { emit('update:modelValue', value); close() }
function handleEnter() {
  if (filtered.value.length) choose(filtered.value[0].value)
  else if (canUseCustom.value) choose(query.value.trim())
}
function clear(event) { event.stopPropagation(); emit('update:modelValue', ''); query.value = ''; close() }
onBeforeUnmount(close)
</script>

<template>
  <div ref="trigger" class="select-trigger" :class="{ active: open, disabled }" @click="show">
    <input ref="input" :value="open ? query : displayText" :placeholder="placeholder" :readonly="!open" :disabled="disabled" @input="query = $event.target.value" @keydown.enter.prevent="handleEnter" @keydown.esc="close" />
    <button v-if="clearable && modelValue && !disabled" type="button" class="select-clear" aria-label="清除" @click="clear">×</button>
    <span class="select-chevron" aria-hidden="true"></span>
  </div>
  <Teleport to="body">
    <div v-if="open" class="select-dismiss" @click="close"></div>
    <div v-if="open" class="select-popover" :style="position">
      <button v-for="option in filtered" :key="option.value" type="button" class="select-option" :class="{ selected: option.value === modelValue }" @click="choose(option.value)">
        <span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span><span v-if="option.value === modelValue" class="option-check">✓</span>
      </button>
      <button v-if="canUseCustom" type="button" class="select-option custom-option" @click="choose(query.trim())"><span><strong>使用“{{ query.trim() }}”</strong><small>创建为新主题</small></span><span>＋</span></button>
      <div v-if="!filtered.length && !canUseCustom" class="select-empty">没有匹配选项</div>
    </div>
  </Teleport>
</template>

<style scoped>
.select-trigger { width: 100%; height: 38px; display: flex; align-items: center; gap: 7px; padding: 0 13px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); transition: var(--transition); cursor: text; }.select-trigger:hover { border-color: #c7cbd3; }.select-trigger.active { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light); }.select-trigger.disabled { cursor: not-allowed; opacity: .55; background: var(--bg-secondary); }.select-trigger input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--text); font-size: .82rem; cursor: inherit; }.select-trigger input::placeholder { color: var(--text-muted); }.select-clear { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%; color: var(--text-muted); line-height: 1; }.select-clear:hover { background: var(--bg-secondary); color: var(--text); }.select-chevron { width: 7px; height: 7px; flex: 0 0 7px; border-right: 1.5px solid var(--text-muted); border-bottom: 1.5px solid var(--text-muted); transform: translateY(-2px) rotate(45deg); }.select-dismiss { position: fixed; inset: 0; z-index: 750; }.select-popover { position: fixed; z-index: 760; max-height: 300px; overflow-y: auto; padding: 6px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); box-shadow: 0 14px 36px rgba(31,35,41,.16); }.select-option { width: 100%; min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 10px; border-radius: 7px; text-align: left; }.select-option:hover,.select-option.selected { background: var(--primary-light); color: var(--primary); }.select-option>span:first-child { min-width: 0; display: flex; flex-direction: column; }.select-option strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; font-weight: 550; }.select-option small { color: var(--text-muted); font-size: .69rem; }.option-check { color: var(--primary); font-weight: 800; }.custom-option { margin-top: 3px; border-top: 1px solid var(--border-light); }.select-empty { padding: 18px 10px; color: var(--text-muted); text-align: center; font-size: .78rem; }
</style>
