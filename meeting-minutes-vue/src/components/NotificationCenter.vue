<script setup>
import { useNotify } from '../composables/useNotify'

const notify = useNotify()
</script>

<template>
  <div class="toast-stack" aria-live="polite">
    <transition-group name="toast">
      <div v-for="item in notify.state.toasts" :key="item.id" class="toast-item" :class="item.type">
        <span class="toast-dot"></span>
        <span class="toast-message">{{ item.message }}</span>
        <button class="toast-close" aria-label="关闭通知" @click="notify.dismiss(item.id)">×</button>
      </div>
    </transition-group>
  </div>

  <transition name="dialog-fade">
    <div v-if="notify.state.dialog" class="dialog-overlay" @click.self="notify.closeDialog(false)">
      <div class="confirm-dialog" role="dialog" aria-modal="true" :aria-label="notify.state.dialog.title">
        <div class="dialog-icon" :class="{ danger: notify.state.dialog.danger }">!</div>
        <div class="dialog-content">
          <h3>{{ notify.state.dialog.title }}</h3>
          <p>{{ notify.state.dialog.message }}</p>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-ghost" @click="notify.closeDialog(false)">{{ notify.state.dialog.cancelText }}</button>
          <button class="btn" :class="notify.state.dialog.danger ? 'btn-danger' : 'btn-primary'" @click="notify.closeDialog(true)">
            {{ notify.state.dialog.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.toast-stack { position: fixed; top: 18px; right: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; width: min(360px, calc(100vw - 32px)); }
.toast-item { display: flex; align-items: center; gap: 10px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-left: 4px solid var(--primary); border-radius: var(--radius); padding: 12px 14px; box-shadow: var(--shadow-lg); }
.toast-item.success { border-left-color: var(--success); }.toast-item.error { border-left-color: var(--danger); }.toast-item.warning { border-left-color: #f59e0b; }
.toast-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); flex-shrink: 0; }.success .toast-dot { background: var(--success); }.error .toast-dot { background: var(--danger); }.warning .toast-dot { background: #f59e0b; }
.toast-message { flex: 1; font-size: .84rem; line-height: 1.45; }.toast-close { color: var(--text-muted); font-size: 1.2rem; }
.toast-enter-active,.toast-leave-active { transition: all .2s ease; }.toast-enter-from,.toast-leave-to { opacity: 0; transform: translateX(20px); }
.dialog-overlay { position: fixed; inset: 0; z-index: 900; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15,23,42,.52); }
.confirm-dialog { width: min(440px, 100%); display: grid; grid-template-columns: 42px 1fr; gap: 14px; padding: 22px; background: var(--surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); }
.dialog-icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; font-weight: 800; color: var(--primary); background: var(--primary-light); }.dialog-icon.danger { color: var(--danger); background: #fee2e2; }
.dialog-content h3 { margin: 1px 0 8px; font-size: 1rem; }.dialog-content p { color: var(--text-secondary); font-size: .86rem; line-height: 1.65; white-space: pre-line; }
.dialog-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.dialog-fade-enter-active,.dialog-fade-leave-active { transition: opacity .18s ease; }.dialog-fade-enter-from,.dialog-fade-leave-to { opacity: 0; }
</style>
