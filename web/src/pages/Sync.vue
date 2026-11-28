<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import { fmtTime, submitTask } from '../composables/tasks'
import { useToast } from '../stores/ui'

const toast = useToast()
const libs = ref<any[]>([])
const status = ref<any>(null)
const rounds = ref<any[]>([])
const events = ref<any[]>([])
const incrEnabled = ref(true)
const incrInterval = ref(30)

let timer: ReturnType<typeof setInterval> | undefined
async function load() {
  try {
    status.value = await api('/api/sync/status')
    rounds.value = (await api('/api/sync/rounds')) || []
    incrEnabled.value = !!status.value?.enabled
    incrInterval.value = status.value?.intervalSec || 30
  } catch { /* 忽略 */ }
}
onMounted(async () => {
  try { libs.value = (await api('/api/libraries')) || [] } catch { /* 忽略 */ }
  load()
  timer = setInterval(load, 5000)
})
onUnmounted(() => clearInterval(timer))

async function fullSync() {
  const ids = libs.value.map((l) => l.id)
  if (!ids.length) { toast.bad('还没有媒体库'); return }
  submitTask(() => api('/api/sync/full', { method: 'POST', body: JSON.stringify({ libraryIds: ids }) }), '全量同步')
}
function incrNow() {
  api('/api/sync/incremental', { method: 'POST' })
    .then((r) => {
      if (r.baseline) toast.ok('已建立增量基线（首轮只记游标）')
      else toast.ok(`增量完成：新事件 ${r.newEvents}，直推 ${r.direct}，目录 ${r.scannedDirs}${r.busy ? '（通道占用，下轮重试）' : ''}`)
      load()
    })
    .catch((e) => toast.bad(e.message))
}
async function testEvents() {
  try {
    events.value = (await api('/api/sync/incremental/test', { method: 'POST' })) || []
    toast.ok(`已读取 ${events.value.length} 条事件`)
  } catch (e: any) { toast.bad(e.message) }
}
async function saveSettings() {
  try {
    await api('/api/sync/settings', { method: 'PUT', body: JSON.stringify({ enabled: incrEnabled.value, intervalSec: Number(incrInterval.value) }) })
    toast.ok('增量设置已保存')
    load()
  } catch (e: any) { toast.bad(e.message) }
}
</script>

<template>
  <h2>同步</h2>
  <div class="status-strip" v-if="status">
    <span><span class="dot" :class="{ off: !status.enabled }"></span>{{ status.enabled ? '自动增量已启用' : '自动增量已关闭' }}</span>
    <span>间隔 <b>{{ status.intervalSec }}</b> 秒</span>
    <span>游标 <b>{{ status.cursor || '未建立' }}</b></span>
    <span>积压 <b>{{ status.pending ?? 0 }}</b></span>
    <span>上次执行 <b>{{ fmtTime(status.lastRun) }}</b></span>
    <span>空转 <b>{{ status.idleRounds ?? 0 }}</b> 轮</span>
    <span v-if="status.lock?.holder">115 通道：<b>{{ status.lock.holder }}</b>（{{ status.lock.heldFor }}，等待 {{ status.lock.waiters }}）</span>
    <span v-if="status.throttle?.breaker?.tripped" class="bad">风控熔断中</span>
  </div>

  <div class="grid2">
    <div class="card">
      <h3>全量同步</h3>
      <p class="muted" style="font-size:13px">全部媒体库逐个扫描；失效检测只对扫描成功的库生效。全量成功后自动推进增量游标。</p>
      <div class="row">
        <button class="btn" @click="fullSync">开始全量</button>
        <span class="muted" style="font-size:12px">共 {{ libs.length }} 个启用的库</span>
      </div>
    </div>
    <div class="card">
      <h3>增量</h3>
      <div class="row" style="margin-bottom:8px">
        <button class="btn ghost" @click="incrNow">立即执行一轮</button>
        <button class="btn ghost" @click="testEvents">测试事件流</button>
      </div>
      <div class="row" style="margin-bottom:8px">
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" v-model="incrEnabled" /> 启用自动增量</label>
        <input v-model.number="incrInterval" type="number" min="15" max="3600" style="width:90px" />
        <span class="muted" style="font-size:12px">秒（15–3600）</span>
        <button class="btn ghost small" @click="saveSettings">保存</button>
      </div>
      <div class="muted" style="font-size:12px">首轮只建基线；先跑全量再开增量。</div>
    </div>
  </div>

  <div class="card" v-if="events.length">
    <h3>测试事件流（只读，不推进游标）</h3>
    <div v-for="e in events" :key="e.id" class="row" style="padding:4px 0;font-size:13px">
      <span>{{ e.fileName || e.fileId }}</span>
      <span class="muted">类型 {{ e.type }} · cid {{ e.cid || '—' }}</span>
    </div>
  </div>

  <div class="card">
    <h3>增量轮次历史（最近 {{ rounds.length }} 轮，空转不记录）</h3>
    <table v-if="rounds.length">
      <thead><tr><th>时间</th><th>事件</th><th>新</th><th>直推</th><th>目录</th><th>失败</th><th>状态</th><th>备注</th></tr></thead>
      <tbody>
        <tr v-for="(r, i) in rounds" :key="i">
          <td class="muted">{{ fmtTime(r.at) }}</td>
          <td>{{ r.events }}</td>
          <td>{{ r.new }}</td>
          <td>{{ r.direct }}</td>
          <td>{{ r.dirs }}</td>
          <td>{{ r.errors }}</td>
          <td>
            <span v-if="r.busy" class="warn">让路</span>
            <span v-else-if="r.yielded" class="warn">礼让</span>
            <span v-else-if="r.baseline" class="ok">基线</span>
            <span v-else-if="r.errors" class="bad">失败</span>
            <span v-else class="ok">完成</span>
          </td>
          <td class="muted" style="font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ r.note }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="muted">还没有轮次记录（一切正常或还没跑过）。</div>
  </div>
</template>
