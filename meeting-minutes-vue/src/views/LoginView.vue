<script setup>
import { computed, ref } from 'vue'
import { useAuth } from '../composables/useAuth'

const emit = defineEmits(['authenticated'])
const { login, register } = useAuth()
const mode = ref('login')
const username = ref('')
const password = ref('')
const displayName = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')
const title = computed(() => mode.value === 'login' ? '欢迎回来' : '创建账号')

function switchMode(nextMode) {
  mode.value = nextMode
  error.value = ''
  password.value = ''
  confirmPassword.value = ''
}

async function submit() {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  if (mode.value === 'register' && password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  loading.value = true
  try {
    if (mode.value === 'login') await login(username.value, password.value)
    else await register(username.value, password.value, displayName.value)
    emit('authenticated')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-brand">
      <div class="brand-mark"><SvgIcon name="clipboard" :size="28" /></div>
      <p class="brand-kicker">MEETING MINUTES</p>
      <h1>让每一次讨论<br />都有迹可循</h1>
      <p class="brand-copy">集中记录会议内容、待办任务和参会人员，历史纪要随时可查。</p>
      <div class="feature-list">
        <span><SvgIcon name="check-circle" :size="17" /> 多会议独立归档</span>
        <span><SvgIcon name="check-circle" :size="17" /> 账号数据安全隔离</span>
        <span><SvgIcon name="check-circle" :size="17" /> 随时继续上次工作</span>
      </div>
    </section>

    <section class="login-panel">
      <div class="login-card">
        <div class="mobile-brand"><SvgIcon name="clipboard" :size="21" /> 会议纪要</div>
        <h2>{{ title }}</h2>
        <p class="login-subtitle">{{ mode === 'login' ? '登录后继续管理你的会议纪要' : '注册一个属于你的纪要空间' }}</p>

        <form @submit.prevent="submit">
          <label v-if="mode === 'register'">
            <span>显示名称</span>
            <input v-model="displayName" autocomplete="name" maxlength="30" placeholder="例如：陈超" />
          </label>
          <label>
            <span>用户名</span>
            <input v-model="username" autocomplete="username" maxlength="32" placeholder="3-32 位字母或数字" autofocus />
          </label>
          <label>
            <span>密码</span>
            <input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" maxlength="128" placeholder="至少 8 位" />
          </label>
          <label v-if="mode === 'register'">
            <span>确认密码</span>
            <input v-model="confirmPassword" type="password" autocomplete="new-password" maxlength="128" placeholder="再次输入密码" />
          </label>
          <p v-if="error" class="login-error">{{ error }}</p>
          <button class="submit-button" type="submit" :disabled="loading">
            {{ loading ? '请稍候…' : (mode === 'login' ? '登录' : '注册并进入') }}
          </button>
        </form>

        <p class="mode-switch">
          {{ mode === 'login' ? '还没有账号？' : '已经有账号？' }}
          <button @click="switchMode(mode === 'login' ? 'register' : 'login')">
            {{ mode === 'login' ? '立即注册' : '返回登录' }}
          </button>
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page { min-height: 100vh; display: grid; grid-template-columns: minmax(340px, 46%) 1fr; background: #f7f8fc; }
.login-brand { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: center; padding: clamp(48px, 7vw, 110px); color: white; background: linear-gradient(145deg, #1d2747, #354fc4 72%, #4f6df5); }
.login-brand::before, .login-brand::after { content: ''; position: absolute; border-radius: 50%; border: 1px solid rgba(255,255,255,.12); }
.login-brand::before { width: 440px; height: 440px; right: -230px; top: -150px; }
.login-brand::after { width: 310px; height: 310px; left: -170px; bottom: -140px; }
.brand-mark { width: 58px; height: 58px; border-radius: 16px; display: grid; place-items: center; margin-bottom: 30px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.18); }
.brand-kicker { margin-bottom: 15px; font-size: .72rem; letter-spacing: .22em; color: #cbd4ff; }
.login-brand h1 { font-size: clamp(2.1rem, 4vw, 3.7rem); line-height: 1.2; letter-spacing: -.04em; }
.brand-copy { max-width: 430px; margin-top: 24px; font-size: 1rem; line-height: 1.9; color: #d9dfff; }
.feature-list { display: flex; flex-direction: column; gap: 13px; margin-top: 42px; color: #edf0ff; }
.feature-list span { display: flex; align-items: center; gap: 10px; }
.login-panel { display: grid; place-items: center; padding: 36px; }
.login-card { width: min(100%, 420px); padding: 44px; border: 1px solid #e7e9f2; border-radius: 20px; background: white; box-shadow: 0 18px 60px rgba(31,35,41,.08); }
.mobile-brand { display: none; align-items: center; gap: 8px; margin-bottom: 30px; color: var(--primary); font-weight: 700; }
.login-card h2 { font-size: 1.75rem; letter-spacing: -.02em; }
.login-subtitle { margin: 6px 0 28px; color: var(--text-muted); }
form { display: flex; flex-direction: column; gap: 17px; }
label { display: flex; flex-direction: column; gap: 7px; }
label span { font-size: .82rem; font-weight: 600; color: var(--text-secondary); }
input { width: 100%; padding: 11px 13px; border: 1px solid var(--border); border-radius: 8px; background: #fff; transition: var(--transition); }
input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light); }
.login-error { padding: 9px 11px; border-radius: 7px; color: #b42318; background: #fff1ef; font-size: .8rem; }
.submit-button { width: 100%; padding: 11px; border-radius: 8px; color: white; background: var(--primary); font-weight: 600; transition: var(--transition); }
.submit-button:hover { background: var(--primary-hover); transform: translateY(-1px); }
.submit-button:disabled { opacity: .6; cursor: wait; transform: none; }
.mode-switch { margin-top: 24px; text-align: center; color: var(--text-muted); font-size: .82rem; }
.mode-switch button { margin-left: 4px; color: var(--primary); font-weight: 600; }
@media (max-width: 760px) {
  .login-page { display: block; background: linear-gradient(160deg, #eef1fe, #f8f9fc); padding: 28px 18px; overflow-y: auto; }
  .login-brand { display: none; }
  .login-panel { min-height: calc(100vh - 56px); padding: 0; }
  .login-card { padding: 32px 24px; }
  .mobile-brand { display: flex; }
}
</style>
