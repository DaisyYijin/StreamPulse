<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api'
import { fmtTime, submitTask } from '../composables/tasks'
import { useToast } from '../stores/ui'
import TagInput from '../components/TagInput.vue'

const toast = useToast()
const libs = ref<any[]>([])
const libId = ref<number>(0)
const status = ref<any>(null)
const rounds = ref<any[]>([])
const events = ref<any[]>([])
const incrEnabled = ref(true)
const incrInterval = ref(30)

// 当前库的同步配置表单(对应参考稿的全量同步页)
const form = ref<any>(null)
const saved = ref<any>(null) // 上次保存的配置,重置用

const VIDEO_PRESETS = ['.mp4', '.mkv', '.iso', '.ts', '.avi', '.wmv', '.m2ts']
const META_PRESETS = ['.jpg', '.png', '.srt', '.ass', '.nfo']

let timer: ReturnType<typeof setInterval> | undefined

async function loadLibs() {
  try { libs.value = (await api('/api/libraries')) || [] } catch { /* 忽略 */ }
}
async function load() {
  try {
    status.value = await api('/api/sync/status')
    rounds.value = (await api('/api/sync/rounds')) || []
    incrEnabled.value = !!status.value?.enabled
    incrInterval.value = status.value?.intervalSec || 30
  } catch { /* 忽略 */ }
}
onMounted(async () => {
  await loadLibs()
  load()
  timer = setInterval(load, 5000)
})
onUnmounted(() => clearInterval(timer))

watch(libId, () => loadForm())

function loadForm() {
  const lib = libs.value.find((l) => l.id === libId.value)
  if (lib) {
    form.value = { ...lib }
    saved.value = { ...lib }
  }
}

async function saveConfig() {
  if (!form.value) return
  const f = form.value
  if (!f.name || !f.remoteCid || !f.localDir) { toast.bad('名称 / 远端 CID / 本地目录 必填'); return }
  try {
    await api('/api/libraries', { method: 'POST', body: JSON.stringify(f) })
    toast.ok('配置已保存')
    await loadLibs()
    loadForm()
  } catch (e: any) { toast.bad(e.message) }
}
function resetConfig() {
  if (saved.value) {
    form.value = { ...saved.value }
    toast.ok('已恢复为上次保存的配置')
  }
}
function startFull() {
  if (!libId.value) { toast.bad('先选择媒体库'); return }
  saveConfig().then(() => {
    submitTask(() => api(`/api/libraries/${libId.value}/scan`, { method: 'POST' }), '全量同步')
  })
}

// 目录选择器(点击填入)
const picker = ref<{ open: boolean; cid: string; items: any[] }>({ open: false, cid: '0', items: [] })
async function openPicker() {
  picker.value.open = true
  await loadDirs('0')
}
async function loadDirs(cid: string) {
  try { picker.value.items = (await api('/api/dirs?cid=' + encodeURIComponent(cid))) || [] }
  catch (e: any) { toast.bad(e.message) }
}
async function enterDir(d: any) {
  picker.value.cid = d.cid
  await loadDirs(d.cid)
}
function pickDir() {
  form.value.remoteCid = picker.value.cid
  picker.value.open = false
}

const libName = computed(() => libs.value.find((l) => l.id === libId.value)?.name || '')

// ---------- 增量 ----------
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
  <h2 class="page-title">全量同步</h2>

  <div class="notice">
    <span>ⓘ</span>
    <span>开始全量同步前，请先选择媒体库并核对配置，再点击「开始全量同步」</span>
  </div>

  <div class="card">
    <div class="form-row">
      <span class="form-label"><span class="req">*</span>媒体库</span>
      <div class="form-control">
        <select v-model="libId" style="max-width:320px">
          <option :value="0" disabled>选择要配置的媒体库</option>
          <option v-for="l in libs" :key="l.id" :value="l.id">{{ l.name }}</option>
        </select>
        <span class="form-hint" v-if="libName">上次扫描：{{ fmtTime(libs.find(l => l.id === libId)?.lastScanAt) }}</span>
      </div>
    </div>

    <template v-if="form">
      <div class="form-row">
        <span class="form-label"><span class="req">*</span>同步模式</span>
        <div class="form-control">
          <div class="segmented">
            <button :class="{ on: form.scanMode !== 'normal' }" @click="form.scanMode = 'fast'">快速模式</button>
            <button :class="{ on: form.scanMode === 'normal' }" @click="form.scanMode = 'normal'">普通模式</button>
          </div>
          <span class="form-hint">快速每页 1000 条，普通每页 200 条对风控更稳</span>
        </div>
      </div>

      <div class="form-row">
        <span class="form-label"><span class="req">*</span>115 媒体库 cid</span>
        <div class="form-control">
          <input v-model="form.remoteCid" placeholder="115 目录 id，0 为网盘根" />
          <button class="btn" @click="openPicker">点击填入</button>
        </div>
      </div>

      <div class="form-row">
        <span class="form-label"><span class="req">*</span>本地媒体库目录</span>
        <div class="form-control">
          <input v-model="form.localDir" placeholder="/media（Emby 必须挂载同一目录）" />
        </div>
      </div>

      <div class="form-row">
        <span class="form-label"><span class="req">*</span>视频文件后缀</span>
        <div class="form-control" style="flex-direction:column;align-items:stretch">
          <TagInput v-model="form.videoExts" :presets="VIDEO_PRESETS" placeholder="输入后缀后回车" />
        </div>
      </div>

      <div class="form-row">
        <span class="form-label">媒体图片后缀</span>
        <div class="form-control" style="flex-direction:column;align-items:stretch">
          <TagInput v-model="form.metaExts" :presets="META_PRESETS" placeholder="随扫描一并下载的附属文件" />
        </div>
      </div>

      <div class="form-row">
        <span class="form-label">最小体积 (MB)</span>
        <div class="form-control">
          <input v-model.number="form.minSize" type="number" min="0" style="max-width:160px" />
          <span class="form-hint">过滤样本/广告小文件，0 = 不过滤</span>
        </div>
      </div>

      <div class="form-row">
        <span class="form-label">自动刮削</span>
        <div class="form-control">
          <label style="display:flex;gap:6px;align-items:center">
            <input type="checkbox" v-model="form.scrape" /> 同步后用 TMDB 写 nfo/海报（需在设置页填 Key）
          </label>
        </div>
      </div>

      <div class="form-row">
        <span class="form-label"></span>
        <div class="form-control">
          <button class="btn" @click="saveConfig">保存配置</button>
          <button class="btn orange" @click="resetConfig">重置配置</button>
          <button class="btn" @click="startFull">开始全量同步</button>
        </div>
      </div>
    </template>
    <div v-else class="muted" style="padding-left:144px">先在上方选择一个媒体库；没有的话到「媒体库」页添加。</div>
  </div>

  <h2 class="page-title">增量同步</h2>
  <div class="status-strip" v-if="status">
    <span><span class="dot" :class="{ off: !status.enabled }"></span>{{ status.enabled ? '自动增量已启用' : '已关闭' }}</span>
    <span>间隔 <b>{{ status.intervalSec }}</b> 秒</span>
    <span>游标 <b>{{ status.cursor || '未建立' }}</b></span>
    <span>积压 <b>{{ status.pending ?? 0 }}</b></span>
    <span>上次执行 <b>{{ fmtTime(status.lastRun) }}</b></span>
    <span>空转 <b>{{ status.idleRounds ?? 0 }}</b> 轮</span>
    <span v-if="status.lock?.holder">115 通道：<b>{{ status.lock.holder }}</b>（{{ status.lock.heldFor }}）</span>
    <span v-if="status.throttle?.breaker?.tripped" class="bad">风控熔断中：{{ status.throttle.breaker.reason }}</span>
  </div>

  <div class="card">
    <div class="form-row">
      <span class="form-label"></span>
      <div class="form-control">
        <button class="btn ghost" @click="incrNow">立即执行一轮</button>
        <button class="btn ghost" @click="testEvents">测试事件流</button>
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" v-model="incrEnabled" /> 自动增量</label>
        <input v-model.number="incrInterval" type="number" min="15" max="3600" style="width:90px" />
        <span class="form-hint">秒（15–3600）</span>
        <button class="btn ghost small" @click="saveSettings">保存</button>
      </div>
    </div>
    <div v-if="events.length" style="border-top:1px solid var(--border);padding-top:10px">
      <div class="form-hint" style="margin-bottom:6px">测试事件流（只读，不推进游标）</div>
      <div v-for="e in events" :key="e.id" class="row" style="padding:3px 0;font-size:13px">
        <span>{{ e.fileName || e.fileId }}</span>
        <span class="muted">类型 {{ e.type }} · cid {{ e.cid || '—' }}</span>
      </div>
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
    <div v-else class="muted">还没有轮次记录。</div>
  </div>

  <!-- 目录选择器 -->
  <div v-if="picker.open" class="modal-mask" @click.self="picker.open = false">
    <div class="card modal" style="width:460px">
      <h3>选择远端目录（当前 {{ picker.cid }}）</h3>
      <div class="row" style="margin-bottom:8px">
        <button class="btn ghost small" @click="enterDir({ cid: '0' })">回根目录</button>
      </div>
      <div v-for="d in picker.items" :key="d.cid" class="row"
           style="padding:7px 10px;border-radius:6px;cursor:pointer"
           @click="enterDir(d)">
        <span>📁 {{ d.name }}</span>
        <span class="muted" style="font-size:12px;margin-left:auto">{{ d.cid }}</span>
      </div>
      <div v-if="!picker.items.length" class="muted">没有子目录</div>
      <button class="btn" style="margin-top:10px" @click="pickDir">使用当前目录</button>
    </div>
  </div>
</template>
