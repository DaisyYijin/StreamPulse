<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import { fmtBytes, fmtTime } from '../composables/tasks'
import { DEVICE_OPTIONS } from '../composables/tasks'
import { useToast } from '../stores/ui'

const toast = useToast()
const account = ref<any>(null)
const settings = ref<any>(null)
const qr = ref<any>(null)
const qrMode = ref<'scan' | 'open'>('scan')
const qrMsg = ref('')
const device = ref('web')
const appId = ref('')
let pollTimer: ReturnType<typeof setInterval> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined

async function load() {
  try {
    const accs = (await api('/api/accounts')) || []
    account.value = accs[0] || null
    settings.value = await api('/api/settings')
    appId.value = settings.value.p115AppId || ''
  } catch { /* 忽略 */ }
}
onMounted(() => { load(); refreshTimer = setInterval(load, 8000) })
onUnmounted(() => { clearInterval(refreshTimer); stopPoll() })

function parseProfile(a: any) {
  try { return JSON.parse(a?.profile || '{}') } catch { return {} }
}

// ---------- 扫码登录 ----------
async function startQr() {
  stopPoll()
  qrMsg.value = ''
  qrMode.value = 'scan'
  try {
    qr.value = await api('/api/accounts/qrcode', { method: 'POST', body: JSON.stringify({ device: device.value }) })
    pollTimer = setInterval(pollQr, 1800)
  } catch (e: any) {
    qrMsg.value = e.message
  }
}
async function pollQr() {
  if (!qr.value) return stopPoll()
  try {
    const st = await api('/api/accounts/qrcode/' + qr.value.uid)
    if (st.status === 2) {
      stopPoll(); qr.value = null; toast.ok('115 登录成功'); load()
    } else if (st.status === -1 || st.status === -2) {
      qrMsg.value = st.message || '二维码已过期，请刷新'
      stopPoll()
    }
  } catch { /* 下轮再试 */ }
}
function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined } }

// ---------- 开放平台 ----------
async function startOpen() {
  stopPoll()
  qrMsg.value = ''
  qrMode.value = 'open'
  try {
    const r = await api('/api/accounts/open/start', { method: 'POST', body: JSON.stringify({ appId: appId.value }) })
    qr.value = { uid: r.uid, content: r.content }
    pollTimer = setInterval(pollOpen, 2000)
  } catch (e: any) {
    qrMsg.value = e.message
  }
}
async function pollOpen() {
  if (!qr.value) return stopPoll()
  try {
    const st = await api('/api/accounts/open/' + qr.value.uid)
    if (st.status === 2) { stopPoll(); qr.value = null; toast.ok('开放平台授权成功'); load() }
  } catch (e: any) {
    qrMsg.value = e.message; stopPoll()
  }
}

async function refreshAccount() {
  try { await api('/api/accounts/refresh', { method: 'POST' }); toast.ok('账号信息已刷新'); load() }
  catch (e: any) { toast.bad(e.message) }
}
async function logout115() {
  if (!confirm('退出 115 登录？媒体库配置会保留。')) return
  try { await api('/api/accounts/115/logout', { method: 'POST' }); toast.ok('已退出 115 登录'); load() }
  catch (e: any) { toast.bad(e.message) }
}
</script>

<template>
  <h2>账号</h2>
  <div class="status-strip">
    <span>登录方式 <b>{{ account ? (account.authType === 'openapi' ? '开放平台' : '扫码 Cookie') : '未登录' }}</b></span>
    <span v-if="account">设备 <b>{{ account.device }}</b></span>
    <span v-if="account">UID <b>{{ account.uid || '—' }}</b></span>
  </div>

  <div class="grid2">
    <div class="card">
      <h3>账号资料</h3>
      <template v-if="account && account.authType !== 'none'">
        <div class="row" style="margin-bottom:8px">
          <div class="avatar" style="width:44px;height:44px;border-radius:50%;background:var(--panel-2);display:flex;align-items:center;justify-content:center">
            {{ (parseProfile(account).name || account.nickname || '?').slice(0, 1) }}
          </div>
          <b style="font-size:15px">{{ parseProfile(account).name || account.nickname }}</b>
          <span class="badge vip" v-if="Number(parseProfile(account).vip)">VIP</span>
        </div>
        <div class="muted" style="font-size:13px">
          {{ fmtBytes(parseProfile(account).used) }} / {{ fmtBytes(parseProfile(account).total) }}
          · 剩余 {{ fmtBytes(Math.max(0, (parseProfile(account).total || 0) - (parseProfile(account).used || 0))) }}
        </div>
        <div class="quota" style="height:8px;background:var(--panel-2);border-radius:4px;margin:8px 0">
          <i style="display:block;height:100%;background:var(--accent);border-radius:4px"
             :style="{ width: (parseProfile(account).total ? Math.min(100, Math.round(parseProfile(account).used / parseProfile(account).total * 100)) : 0) + '%' }"></i>
        </div>
        <div class="muted" style="font-size:12px">更新于 {{ fmtTime(account.updatedAt) }}</div>
        <div class="row" style="margin-top:10px">
          <button class="btn ghost small" @click="refreshAccount">刷新详情</button>
          <button class="btn danger small" @click="logout115">退出登录</button>
        </div>
      </template>
      <div v-else class="muted">还没有登录 115，先扫码登录。</div>
    </div>

    <div class="card">
      <h3>扫码登录 115</h3>
      <div class="row" style="margin-bottom:8px">
        <select v-model="device">
          <option v-for="d in DEVICE_OPTIONS" :key="d.value" :value="d.value">{{ d.label }}</option>
        </select>
        <button class="btn" :disabled="!!qr" @click="startQr">开始扫码</button>
      </div>
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        重新扫码会替换当前账号；小程序会话同样可用。
      </div>
      <h3>开放平台（可选）</h3>
      <div class="row">
        <input v-model="appId" placeholder="AppID（设置页也可保存）" style="flex:1" />
        <button class="btn ghost" :disabled="!!qr" @click="startOpen">设备码授权</button>
      </div>
      <div class="muted" style="font-size:12px;margin-top:6px">
        配置 AppID 后开放平台账号优先于扫码账号。
      </div>
    </div>
  </div>

  <div class="card" v-if="qr || qrMsg">
    <h3>{{ qrMode === 'open' ? '开放平台授权' : '扫码' }}</h3>
    <div v-if="qr && qr.content" style="text-align:center">
      <img :src="'/api/qr?text=' + encodeURIComponent(qr.content)" alt="二维码" style="width:200px;height:200px" />
      <div class="muted" style="font-size:13px">请用 115 App 扫码</div>
    </div>
    <div v-if="qrMsg" class="bad">{{ qrMsg }}</div>
  </div>
</template>
