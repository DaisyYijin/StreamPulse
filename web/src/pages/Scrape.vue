<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import { fmtTime, submitTask } from '../composables/tasks'
import { useToast } from '../stores/ui'

const toast = useToast()
const libs = ref<any[]>([])
const records = ref<any[]>([])
let timer: ReturnType<typeof setInterval> | undefined

async function load() {
  try {
    libs.value = (await api('/api/libraries')) || []
    records.value = (await api('/api/scrape/records')) || []
  } catch { /* 忽略 */ }
}
onMounted(() => { load(); timer = setInterval(load, 10000) })
onUnmounted(() => clearInterval(timer))

function run(l: any) {
  submitTask(() => api(`/api/libraries/${l.id}/scrape`, { method: 'POST' }), `刮削 ${l.name}`)
}
async function toggle(l: any) {
  try {
    await api('/api/libraries', { method: 'POST', body: JSON.stringify({ ...l, scrape: !l.scrape }) })
    toast.ok(l.scrape ? `${l.name} 已关闭自动刮削` : `${l.name} 已开启自动刮削`)
    load()
  } catch (e: any) { toast.bad(e.message) }
}
function libName(id: number) {
  return libs.value.find((l) => l.id === id)?.name || ('#' + id)
}
</script>

<template>
  <h2>刮削</h2>
  <div class="status-strip">
    <span class="muted">TMDB API Key 在「设置」填写；产物（nfo/海报）写进本地媒体目录，Emby 扫描即用</span>
  </div>

  <div class="card">
    <h3>媒体库</h3>
    <table v-if="libs.length">
      <thead><tr><th>名称</th><th>自动刮削</th><th>手动</th></tr></thead>
      <tbody>
        <tr v-for="l in libs" :key="l.id">
          <td>{{ l.name }}</td>
          <td>
            <button class="btn ghost small" @click="toggle(l)">{{ l.scrape ? '开启中，点击关闭' : '已关闭，点击开启' }}</button>
          </td>
          <td><button class="btn small" @click="run(l)">立即刮削</button></td>
        </tr>
      </tbody>
    </table>
    <div v-else class="muted">还没有媒体库。</div>
  </div>

  <div class="card">
    <h3>刮削记录</h3>
    <table v-if="records.length">
      <thead><tr><th>时间</th><th>媒体库</th><th>成功</th><th>失败</th><th>已存在</th><th>备注</th></tr></thead>
      <tbody>
        <tr v-for="r in records" :key="r.id">
          <td class="muted">{{ fmtTime(r.createdAt) }}</td>
          <td>{{ libName(r.libraryId) }}</td>
          <td>{{ r.ok }}</td>
          <td :class="r.failed ? 'bad' : ''">{{ r.failed }}</td>
          <td>{{ r.skipped }}</td>
          <td class="muted" style="font-size:12px;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ r.message }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="muted">还没有记录。</div>
  </div>
</template>
