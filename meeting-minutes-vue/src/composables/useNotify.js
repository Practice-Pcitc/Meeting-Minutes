import { reactive } from 'vue'

const state = reactive({
  toasts: [],
  dialog: null,
})

let nextId = 1

function toast(message, type = 'info', duration = 2800) {
  const id = nextId++
  state.toasts.push({ id, message, type })
  if (duration > 0) setTimeout(() => dismiss(id), duration)
  return id
}

function dismiss(id) {
  const index = state.toasts.findIndex((item) => item.id === id)
  if (index >= 0) state.toasts.splice(index, 1)
}

function confirm(options) {
  const normalized = typeof options === 'string' ? { message: options } : options
  return new Promise((resolve) => {
    state.dialog = {
      title: normalized.title || '请确认',
      message: normalized.message || '',
      confirmText: normalized.confirmText || '确认',
      cancelText: normalized.cancelText || '取消',
      danger: Boolean(normalized.danger),
      resolve,
    }
  })
}

function closeDialog(result) {
  const dialog = state.dialog
  state.dialog = null
  dialog?.resolve(result)
}

export function useNotify() {
  return {
    state,
    success: (message) => toast(message, 'success'),
    error: (message) => toast(message, 'error', 4200),
    info: (message) => toast(message, 'info'),
    warning: (message) => toast(message, 'warning', 3600),
    confirm,
    dismiss,
    closeDialog,
  }
}
