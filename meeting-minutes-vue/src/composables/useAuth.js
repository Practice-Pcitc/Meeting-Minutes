import { computed, reactive } from 'vue'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const TOKEN_KEY = 'meeting_minutes_token'

const auth = reactive({
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: null,
  ready: false,
})

function setSession(session) {
  auth.token = session?.token || ''
  auth.user = session?.user || null
  if (auth.token) localStorage.setItem(TOKEN_KEY, auth.token)
  else localStorage.removeItem(TOKEN_KEY)
}

export async function authRequest(method, path, body, { allowAnonymous = false } = {}) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('无法连接服务器，请稍后重试')
  }
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (response.status === 401 && !allowAnonymous) setSession(null)
  if (!response.ok) throw new Error(data?.message || `请求失败（${response.status}）`)
  return data
}

export async function authFetch(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}), ...(options.headers || {}) },
    })
  } catch {
    throw new Error('无法连接服务器，请稍后重试')
  }
  if (response.status === 401) setSession(null)
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.message || `请求失败（${response.status}）`)
  }
  return response
}

async function restoreSession() {
  if (!auth.token) {
    auth.ready = true
    return
  }
  try {
    auth.user = await authRequest('GET', '/auth/me')
  } catch {
    setSession(null)
  } finally {
    auth.ready = true
  }
}

async function login(username, password) {
  const session = await authRequest('POST', '/auth/login', { username, password }, { allowAnonymous: true })
  setSession(session)
  return session.user
}

async function register(username, password, displayName) {
  const session = await authRequest('POST', '/auth/register', { username, password, displayName }, { allowAnonymous: true })
  setSession(session)
  return session.user
}

async function logout() {
  try {
    if (auth.token) await authRequest('POST', '/auth/logout')
  } finally {
    setSession(null)
  }
}

async function updatePreferences(preferences) {
  auth.user = await authRequest('POST', '/auth/preferences', preferences)
  return auth.user
}

restoreSession()

export function useAuth() {
  return {
    auth,
    isAuthenticated: computed(() => Boolean(auth.token && auth.user)),
    login,
    register,
    logout,
    updatePreferences,
  }
}
