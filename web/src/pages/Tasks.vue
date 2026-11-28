<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import { fmtTime } from '../composables/tasks'

const tasks = ref<any[]>([])
let timer: ReturnType<typeof setInterval> | undefined
async function load() {
  try { tasks.value = (await api('/api/tasks')) || [] } catch { /* 忽略 */ }
}
onMounted(() => { load(); timer = setInterval(load, 3000) })
onUnmounted(() => clearInterval(timer))

const kindLabel: Record<string, string> = {
  scan: '扫描', 'sync-dir': '目录同步', 'full-sync': '全量同步', scrape: '刮削', adopt: '接管',
}
</script>

<template>
  <h2 class="page-title">任务</h2>
  <div class="status-strip">
    <span class="muted">手动操作一律入队串行执行；重复点击自动合并；增量会与任务互相礼让</span>
  </div>
  <div class="card">
    <table v-if="tasks.length">
      <thead><tr><th>#</th><th>类型</th><th>状态</th><th>信息</th><th>开始</th><th>结束</th></tr></thead>
      <tbody>
        <tr v-for="t in tasks" :key="t.id">
          <td class="muted">{{ t.id }}</td>
          <td>{{ kindLabel[t.kind] || t.kind }}</td>
          <td>
            <span class="warn" v-if="t.status === 'queued'">排队中</span>
            <span class="warn" v-else-if="t.status === 'running'">执行中</span>
            <span class="ok" v-else-if="t.status === 'done'">完成</span>
            <span class="bad" v-else>失败</span>
          </td>
          <td style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ t.message || '—' }}</td>
          <td class="muted">{{ fmtTime(t.startedAt) }}</td>
          <td class="muted">{{ fmtTime(t.endedAt) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="muted">还没有任务。</div>
  </div>
</template>
