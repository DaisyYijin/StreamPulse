<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, publicJSON, setToken } from '../api'

const router = useRouter()
const username = ref('')
const password = ref('')
const msg = ref('')
const busy = ref(false)
const initialized = ref(true)

publicJSON('/api/setup/status')
  .then((s) => (initialized.value = s.initialized))
  .catch(() => {})

async function submit() {
  msg.value = ''
  busy.value = true
  try {
    if (!initialized.value) {
      const d = await publicJSON('/api/setup', {
        method: 'POST',
        body: JSON.stringify({ username: username.value.trim() || 'admin', password: password.value, confirm: password.value }),
      })
      setToken(d.token)
    } else {
      const d = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.value.trim(), password: password.value }),
      })
      setToken(d.token)
    }
    router.push('/')
  } catch (e: any) {
    msg.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="card login-card">
      <h2>StreamPulse</h2>
      <p class="muted">{{ initialized ? '登录管理后台' : '创建管理员账号' }}</p>
      <div class="field">
        <label>用户名</label>
        <input v-model="username" placeholder="admin" @keyup.enter="submit" />
      </div>
      <div class="field">
        <label>密码{{ initialized ? '' : '（至少 8 位）' }}</label>
        <input v-model="password" type="password" @keyup.enter="submit" />
      </div>
      <div v-if="msg" class="bad">{{ msg }}</div>
      <button class="btn" :disabled="busy" @click="submit">{{ busy ? '提交中…' : initialized ? '登录' : '创建管理员' }}</button>
    </div>
  </div>
</template>

<style scoped>
.login-wrap { display: flex; align-items: center; justify-content: center; height: 100%; }
.login-card { width: 360px; }
</style>
