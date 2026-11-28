<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { submitTask } from '../composables/tasks'
import { useToast } from '../stores/ui'

const toast = useToast()
const libs = ref<any[]>([])
const stats = ref<Record<string, any>>({})
const showForm = ref(false)
const editing = ref<any>(null)
const orphans = ref<any[]>([])
const orphanLib = ref<number | null>(null)

const form = ref<any>(emptyForm())
function emptyForm() {
  return {
    id: 0, name: '', remoteCid: '0', localDir: '', scanMode: 'fast',
    videoExts: '.mkv,.mp4,.ts,.m2ts,.iso,.avi,.mov,.wmv,.flv,.rmvb,.webm',
    metaExts: '.srt,.ass,.nfo,.jpg,.png', minSize: 0, keepExt: false,
    strmFormat: 'pick_code', scrape: false,
  }
}

async function load() {
  try {
    libs.value = (await api('/api/libraries')) || []
  } catch { /* 忽略 */ }
}
onMounted(load)

function openAdd() {
  editing.value = null
  form.value = emptyForm()
  showForm.value = true
}
function openEdit(l: any) {
  editing.value = l
  form.value = { ...emptyForm(), ...l }
  showForm.value = true
}
async function save() {
  const f = form.value
  if (!f.name || !f.remoteCid || !f.localDir) { toast.bad('名称 / 远端 CID / 本地目录 必填'); return }
  try {
    await api('/api/libraries', { method: 'POST', body: JSON.stringify(f) })
    toast.ok('媒体库已保存')
    showForm.value = false
    load()
  } catch (e: any) { toast.bad(e.message) }
}
async function remove(l: any) {
  if (!confirm(`删除媒体库「${l.name}」？本地 STRM 与台账记录都会删除（网盘文件不动）。`)) return
  try { await api('/api/libraries/' + l.id, { method: 'DELETE' }); toast.ok('已删除'); load() }
  catch (e: any) { toast.bad(e.message) }
}
function scan(l: any) {
  submitTask(() => api(`/api/libraries/${l.id}/scan`, { method: 'POST' }), `扫描 ${l.name}`)
}
function scrape(l: any) {
  submitTask(() => api(`/api/libraries/${l.id}/scrape`, { method: 'POST' }), `刮削 ${l.name}`)
}
async function syncDir(l: any) {
  const cid = prompt('输入远端目录 CID（可在添加/编辑的目录选择器里找）')
  if (!cid) return
  submitTask(() => api(`/api/libraries/${l.id}/sync-dir`, { method: 'POST', body: JSON.stringify({ cid }) }), `目录同步`)
}

// 远端目录选择器
const dirPicker = ref<{ open: boolean; cid: string; items: any[] }>({ open: false, cid: '0', items: [] })
async function openPicker() {
  dirPicker.value.open = true
  dirPicker.value.cid = form.value.remoteCid || '0'
  await loadDirs('0')
}
async function loadDirs(cid: string) {
  try {
    dirPicker.value.items = (await api('/api/dirs?cid=' + encodeURIComponent(cid))) || []
  } catch (e: any) { toast.bad(e.message) }
}
async function enterDir(d: any) {
  dirPicker.value.cid = d.cid
  await loadDirs(d.cid)
}
function pickDir() {
  form.value.remoteCid = dirPicker.value.cid
  dirPicker.value.open = false
}

// 孤儿管理
async function loadOrphans(l: any) {
  orphanLib.value = l.id
  try { orphans.value = (await api(`/api/libraries/${l.id}/orphans`)) || [] }
  catch (e: any) { toast.bad(e.message) }
}
async function cleanOrphans() {
  if (!orphanLib.value || !confirm(`确认清理 ${orphans.value.length} 个失效 STRM？本地文件会被删除。`)) return
  try {
    const r = await api(`/api/libraries/${orphanLib.value}/orphans/clean`, { method: 'POST' })
    toast.ok(`已清理 ${r.removed} 个文件，回收 ${r.dirs} 个空目录`)
    orphans.value = []
    load()
  } catch (e: any) { toast.bad(e.message) }
}
</script>

<template>
  <h2>媒体库</h2>
  <div class="status-strip">
    <span><b>{{ libs.length }}</b> 个库</span>
    <span class="muted">扫描会写入 STRM 到本地目录；目录改名会自动迁移本地文件</span>
    <button class="btn" style="margin-left:auto" @click="openAdd">添加媒体库</button>
  </div>

  <div class="card">
    <table v-if="libs.length">
      <thead><tr><th>名称</th><th>远端 CID</th><th>本地目录</th><th>模式</th><th>刮削</th><th>上次扫描</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="l in libs" :key="l.id">
          <td>{{ l.name }}</td>
          <td class="muted">{{ l.remoteCid }}</td>
          <td class="muted">{{ l.localDir }}</td>
          <td>{{ l.scanMode === 'normal' ? '标准' : '快速' }}</td>
          <td><span class="dot" :class="{ off: !l.scrape }"></span></td>
          <td class="muted">{{ l.lastScanAt ? new Date(l.lastScanAt * 1000).toLocaleString() : '—' }}</td>
          <td>
            <button class="btn small" @click="scan(l)">扫描</button>
            <button class="btn ghost small" @click="syncDir(l)">目录同步</button>
            <button class="btn ghost small" @click="scrape(l)">刮削</button>
            <button class="btn ghost small" @click="loadOrphans(l)">失效 {{ '' }}</button>
            <button class="btn ghost small" @click="openEdit(l)">编辑</button>
            <button class="btn danger small" @click="remove(l)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="muted">还没有媒体库，点右上角添加。</div>
  </div>

  <div class="card" v-if="orphanLib">
    <h3>失效 STRM 预览（库 #{{ orphanLib }}）</h3>
    <div v-if="!orphans.length" class="muted">没有失效文件。</div>
    <template v-else>
      <div class="muted" style="font-size:13px;margin-bottom:8px">共 {{ orphans.length }} 个；清理只删本地文件与空目录，网盘不动。</div>
      <div style="max-height:240px;overflow:auto">
        <div v-for="f in orphans" :key="f.fid" class="muted" style="font-size:12px">{{ f.strmPath }}</div>
      </div>
      <button class="btn danger" style="margin-top:8px" @click="cleanOrphans">确认清理</button>
    </template>
  </div>

  <!-- 表单弹层 -->
  <div v-if="showForm" style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10"
       @click.self="showForm = false">
    <div class="card" style="width:560px;max-height:86vh;overflow:auto;margin:0">
      <h3>{{ editing ? '编辑媒体库' : '添加媒体库' }}</h3>
      <div class="field"><label>名称</label><input v-model="form.name" placeholder="电影" /></div>
      <div class="field">
        <label>远端 CID（0 = 网盘根）</label>
        <div class="row">
          <input v-model="form.remoteCid" style="flex:1" />
          <button class="btn ghost small" @click="openPicker">选择目录</button>
        </div>
      </div>
      <div class="field"><label>本地目录（容器内路径，如 /media/movies）</label><input v-model="form.localDir" /></div>
      <div class="field">
        <label>扫描模式</label>
        <select v-model="form.scanMode">
          <option value="fast">快速（每页 1000）</option>
          <option value="normal">标准（每页 200，对风控更稳）</option>
        </select>
      </div>
      <div class="field"><label>视频扩展名</label><input v-model="form.videoExts" /></div>
      <div class="field"><label>附属扩展名</label><input v-model="form.metaExts" /></div>
      <div class="row" style="margin-bottom:10px">
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" v-model="form.keepExt" /> STRM 保留视频扩展名</label>
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" v-model="form.scrape" /> 同步后自动刮削</label>
      </div>
      <div class="row">
        <button class="btn" @click="save">保存</button>
        <button class="btn ghost" @click="showForm = false">取消</button>
      </div>
    </div>
  </div>

  <!-- 目录选择器弹层 -->
  <div v-if="dirPicker.open" style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:11"
       @click.self="dirPicker.open = false">
    <div class="card" style="width:460px;max-height:70vh;overflow:auto;margin:0">
      <h3>选择远端目录（当前 {{ dirPicker.cid }}）</h3>
      <div class="row" style="margin-bottom:8px">
        <button class="btn ghost small" @click="enterDir({ cid: '0' })">回根目录</button>
      </div>
      <div v-for="d in dirPicker.items" :key="d.cid"
           style="padding:6px 8px;border-radius:6px;cursor:pointer" class="row"
           @click="enterDir(d)">
        <span>📁 {{ d.name }}</span>
        <span class="muted" style="font-size:12px;margin-left:auto">{{ d.cid }}</span>
      </div>
      <div v-if="!dirPicker.items.length" class="muted">没有子目录</div>
      <button class="btn" style="margin-top:10px" @click="pickDir">使用当前目录</button>
    </div>
  </div>
</template>
