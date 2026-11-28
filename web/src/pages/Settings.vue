<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { useToast } from '../stores/ui'

const toast = useToast()
const s = ref<any>({})
const embyApiKey = ref('')
const embyWebhookToken = ref('')
const tmdbApiKey = ref('')
const newPassword = ref('')
const saving = ref(false)

async function load() {
  try { s.value = await api('/api/settings') } catch (e: any) { /* 忽略 */ }
}
onMounted(load)

async function save() {
  saving.value = true
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        embyBase: s.value.embyBase || '',
        embyApiKey: embyApiKey.value,
        embyWebhookToken: embyWebhookToken.value,
        embyDeleteRemote: !!s.value.embyDeleteRemote,
        p115AppId: s.value.p115AppId || '',
        adminUser: s.value.adminUser || '',
        publicBase: s.value.publicBase || '',
        apiWaitSec: Number(s.value.apiWaitSec) || 0,
        tmdbApiKey: tmdbApiKey.value,
        tmdbLanguage: s.value.tmdbLanguage || 'zh-CN',
        newPassword: newPassword.value,
      }),
    })
    toast.ok('设置已保存')
    embyApiKey.value = ''
    embyWebhookToken.value = ''
    tmdbApiKey.value = ''
    newPassword.value = ''
    load()
  } catch (e: any) { toast.bad(e.message) } finally { saving.value = false }
}

async function exportBackup() {
  try {
    const res = await fetch('/api/backup/export', { headers: { Authorization: 'Bearer ' + localStorage.getItem('sp_token') } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `streampulse-backup-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.ok('备份已下载')
  } catch (e: any) { toast.bad(e.message) }
}
async function restoreBackup(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!confirm('恢复将替换数据库与密钥（重启应用后生效，恢复前自动留档）。继续？')) { input.value = ''; return }
  const fd = new FormData()
  fd.append('file', file)
  try {
    const r = await api('/api/backup/restore', { method: 'POST', body: fd })
    toast.ok(r.message || '已暂存，重启后生效')
  } catch (e: any) { toast.bad(e.message) }
  input.value = ''
}
</script>

<template>
  <h2 class="page-title">设置</h2>
  <div class="grid2">
    <div class="card">
      <h3>播放</h3>
      <div class="field"><label>播放地址（写进 STRM，修改后需重新扫描）</label>
        <input v-model="s.publicBase" placeholder="http://NAS_IP:2048" /></div>
    </div>

    <div class="card">
      <h3>Emby</h3>
      <div class="field"><label>Emby 地址</label><input v-model="s.embyBase" placeholder="http://NAS_IP:8096" /></div>
      <div class="field"><label>API Key</label>
        <input v-model="embyApiKey" :placeholder="s.embyApiKeySet ? '已设置（留空不修改）' : 'API Key'" /></div>
      <div class="field"><label>Webhook Token</label>
        <input v-model="embyWebhookToken" :placeholder="s.embyWebhookTokenSet ? '已设置（留空不修改）' : 'Token'" /></div>
      <label style="display:flex;gap:6px;align-items:center">
        <input type="checkbox" v-model="s.embyDeleteRemote" /> 删除联动同时删网盘（进 115 回收站，可还原）
      </label>
    </div>

    <div class="card">
      <h3>刮削（TMDB）</h3>
      <div class="field"><label>API Key</label>
        <input v-model="tmdbApiKey" :placeholder="s.tmdbApiKeySet ? '已设置（留空不修改）' : 'v3 API Key'" /></div>
      <div class="field"><label>语言</label>
        <select v-model="s.tmdbLanguage"><option value="zh-CN">中文（zh-CN）</option><option value="en-US">English</option></select></div>
    </div>

    <div class="card">
      <h3>115</h3>
      <div class="field"><label>开放平台 AppID（可选）</label><input v-model="s.p115AppId" /></div>
      <div class="field"><label>API 等待时间（秒，1–60）</label><input v-model="s.apiWaitSec" type="number" min="1" max="60" /></div>
    </div>

    <div class="card">
      <h3>管理员</h3>
      <div class="field"><label>用户名</label><input v-model="s.adminUser" /></div>
      <div class="field"><label>新密码（至少 8 位，留空不修改）</label><input v-model="newPassword" type="password" /></div>
    </div>

    <div class="card">
      <h3>备份</h3>
      <div class="row" style="margin-bottom:8px">
        <button class="btn ghost" @click="exportBackup">导出备份（zip）</button>
      </div>
      <div class="row">
        <label class="btn ghost" style="cursor:pointer">
          上传恢复<input type="file" accept=".zip" style="display:none" @change="restoreBackup" />
        </label>
        <span class="muted" style="font-size:12px">校验后暂存，重启应用时生效</span>
      </div>
    </div>
  </div>
  <button class="btn" style="margin-top:8px" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存全部设置' }}</button>
</template>
