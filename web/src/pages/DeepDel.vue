<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import { fmtTime } from '../composables/tasks'

const records = ref<any[]>([])
const counts = ref<Record<string, number>>({})
const videos30 = ref(0)
const remote30 = ref(0)
const webhook = ref<any>(null)
const statusFilter = ref('')
let timer: ReturnType<typeof setInterval> | undefined

async function load() {
  try {
    const q = statusFilter.value ? `?status=${statusFilter.value}` : ''
    const r = await api('/api/deepdel/records' + q)
    records.value = r.records || []
    counts.value = r.counts || {}
    videos30.value = r.videos30
    remote30.value = r.remote30
    webhook.value = await api('/api/emby/webhook/status')
  } catch { /* 忽略 */ }
}
onMounted(() => { load(); timer = setInterval(load, 10000) })
onUnmounted(() => clearInterval(timer))

function webhookHint(): string {
  if (!webhook.value) return ''
  if (!webhook.value.tokenConfigured) return '未配置 Webhook Token（建议配置防伪造）'
  if (webhook.value.seen.rejectAt) return '最近有被拒的事件，检查 Emby 侧 Token 配置'
  if (webhook.value.seen.deleteAt) return '最近收到过删除事件，链路正常'
  if (webhook.value.seen.anyAt) return '能收到事件，但还没收到删除事件（检查 Emby 通知设置里是否勾选了「删除」）'
  return '还没收到任何事件：检查 Emby 的 Webhook 插件地址是否指向本服务 /api/emby/webhook'
}
</script>

<template>
  <h2 class="page-title">深删记录</h2>
  <div class="status-strip">
    <span>近 30 天：本地删除 <b>{{ videos30 }}</b> · 网盘删除 <b>{{ remote30 }}</b></span>
    <span v-for="(n, k) in counts" :key="k">
      <span class="muted">{{ { done: '完成', rejected: '拦截', failed: '失败' }[k as string] || k }}</span> <b>{{ n }}</b>
    </span>
    <span class="muted" style="margin-left:auto">{{ webhookHint() }}</span>
  </div>

  <div class="card">
    <div class="row" style="margin-bottom:8px">
      <button class="btn ghost small" :class="{ }" @click="statusFilter = ''; load()">全部</button>
      <button class="btn ghost small" @click="statusFilter = 'done'; load()">完成</button>
      <button class="btn ghost small" @click="statusFilter = 'rejected'; load()">拦截</button>
      <button class="btn ghost small" @click="statusFilter = 'failed'; load()">失败</button>
    </div>
    <table v-if="records.length">
      <thead><tr><th>时间</th><th>名称</th><th>类型</th><th>范围</th><th>状态</th><th>本地</th><th>网盘</th><th>说明</th></tr></thead>
      <tbody>
        <tr v-for="r in records" :key="r.id">
          <td class="muted">{{ fmtTime(r.createdAt) }}</td>
          <td>{{ r.itemName }}</td>
          <td>{{ r.mediaType || r.itemType }}</td>
          <td>{{ r.episodeLabel || '—' }}</td>
          <td>
            <span class="ok" v-if="r.status === 'done'">完成</span>
            <span class="warn" v-else-if="r.status === 'rejected'">拦截</span>
            <span class="bad" v-else>失败</span>
          </td>
          <td>{{ r.videoCount }}</td>
          <td>{{ r.remoteCount }}</td>
          <td class="muted" style="font-size:12px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ r.message }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="muted">还没有删除记录。在 Emby 里删除影片（且开启了联动）会出现在这里。</div>
    <div class="muted" style="font-size:12px;margin-top:8px">
      网盘删除会进 115 回收站；如需还原，凭记录里的 fids 到 115 回收站操作。
    </div>
  </div>
</template>
