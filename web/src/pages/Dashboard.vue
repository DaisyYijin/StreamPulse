<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import { fmtTime } from '../composables/tasks'

const status = ref<any>(null)
const sync = ref<any>(null)
let timer: ReturnType<typeof setInterval> | undefined

async function load() {
  try {
    status.value = await api('/api/status')
    sync.value = await api('/api/sync/status')
  } catch { /* 401 由 api 层处理 */ }
}
onMounted(() => { load(); timer = setInterval(load, 5000) })
onUnmounted(() => clearInterval(timer))

const steps = [
  { done: () => (status.value?.accounts ?? 0) > 0, label: '扫码登录 115', to: '/account' },
  { done: () => !!status.value?.playBase, label: '填写播放地址', to: '/settings' },
  { done: () => (status.value?.libraries ?? 0) > 0, label: '添加媒体库', to: '/libraries' },
  { done: () => (status.value?.files ?? 0) > 0, label: '跑一次全量扫描', to: '/sync' },
]
</script>

<template>
  <h2>仪表盘</h2>
  <div class="status-strip" v-if="status">
    <span><span class="dot" :class="{ off: !status.emby }"></span>账号 <b>{{ status.accounts }}</b> 个</span>
    <span>媒体库 <b>{{ status.libraries }}</b> 个</span>
    <span>文件 <b>{{ status.files }}</b> · 失效 <b :class="status.orphans ? 'warn' : ''">{{ status.orphans }}</b></span>
    <span>播放模式 <b>{{ status.playMode }}</b></span>
    <span>Emby <b :class="status.emby ? 'ok' : 'muted'">{{ status.emby ? '已配置' : '未配置' }}</b></span>
    <span>上次扫描 <b>{{ fmtTime(status.lastScan) }}</b></span>
    <span>增量 <b>{{ sync?.enabled ? '开启' : '关闭' }}</b> · 积压 <b>{{ sync?.pending ?? 0 }}</b></span>
    <span v-if="sync?.lock?.holder">115 通道：<b>{{ sync.lock.holder }}</b> 已占 {{ sync.lock.heldFor }}</span>
    <span v-if="sync?.throttle?.breaker?.tripped" class="bad">115 风控熔断中，{{ sync.throttle.breaker.reason }}</span>
    <span class="muted">{{ status.version }}</span>
  </div>

  <div class="card">
    <h3>上手清单</h3>
    <div v-for="(s, i) in steps" :key="i" class="row" style="padding:4px 0">
      <span class="dot" :class="{ off: !s.done() }"></span>
      <span :class="s.done() ? 'muted' : ''">{{ s.label }}</span>
      <router-link :to="s.to" class="muted" style="font-size:12px">前往 →</router-link>
    </div>
  </div>

  <div class="card" v-if="sync?.lastError" >
    <h3>增量最近错误</h3>
    <div class="bad">{{ sync.lastError }}</div>
  </div>
</template>
