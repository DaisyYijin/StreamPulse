<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, clearToken, getToken } from './api'
import { useToast } from './stores/ui'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const isPublic = computed(() => !!route.meta.public)

const nav = [
  { to: '/', label: '仪表盘' },
  { to: '/account', label: '账号' },
  { to: '/libraries', label: '媒体库' },
  { to: '/sync', label: '同步' },
  { to: '/migrate', label: '迁移' },
  { to: '/deepdel', label: '深删记录' },
  { to: '/scrape', label: '刮削' },
  { to: '/tasks', label: '任务' },
  { to: '/settings', label: '设置' },
]

async function logout() {
  try { await api('/api/logout', { method: 'POST' }) } catch { /* 忽略 */ }
  clearToken()
  router.push('/login')
}
</script>

<template>
  <router-view v-if="isPublic" />
  <div v-else class="layout">
    <aside class="side">
      <div class="logo">StreamPulse</div>
      <nav class="menu">
        <router-link v-for="n in nav" :key="n.to" :to="n.to">{{ n.label }}</router-link>
      </nav>
      <div class="foot">
        <button class="btn ghost small" style="width:100%" @click="logout" v-if="getToken()">退出登录</button>
      </div>
    </aside>
    <main class="main">
      <router-view />
    </main>
  </div>
  <div v-if="toast.text" class="toast" :class="{ err: toast.err }">{{ toast.text }}</div>
</template>
