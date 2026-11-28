<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, clearToken, getToken } from '../api'
import { useRouter } from 'vue-router'

const router = useRouter()
const status = ref<any>(null)
const version = ref('')

onMounted(async () => {
  try {
    status.value = await api('/api/status')
    version.value = status.value.version || ''
  } catch {
    /* 401 已由 api 层跳登录 */
  }
})

function logout() {
  api('/api/logout', { method: 'POST' }).catch(() => {})
  clearToken()
  router.push('/login')
}
</script>

<template>
  <div class="layout">
    <aside class="side">
      <div class="logo">StreamPulse</div>
      <nav class="menu">
        <router-link to="/">仪表盘</router-link>
      </nav>
      <div class="foot">
        <span class="muted" style="font-size:12px">{{ version }}</span>
        <button class="btn ghost small" style="margin-top:8px;width:100%" @click="logout">退出登录</button>
      </div>
    </aside>
    <main class="main">
      <h2>仪表盘</h2>
      <p class="muted">前端骨架已就绪，完整页面随各阶段后端交付逐步填充。</p>
      <div class="card" v-if="status">
        <div class="row" style="gap:24px">
          <span>账号 <b>{{ status.accounts }}</b> 个</span>
          <span>媒体库 <b>{{ status.libraries }}</b> 个</span>
          <span>文件 <b>{{ status.files }}</b> 个</span>
          <span>播放模式 <b>{{ status.playMode }}</b></span>
          <span>Emby <b :class="status.emby ? 'ok' : 'muted'">{{ status.emby ? '已配置' : '未配置' }}</b></span>
        </div>
      </div>
    </main>
  </div>
</template>
