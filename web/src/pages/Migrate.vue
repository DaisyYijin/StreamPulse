<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { submitTask } from '../composables/tasks'
import { useToast } from '../stores/ui'

const toast = useToast()
const libs = ref<any[]>([])
const selected = ref<number[]>([])
const plan = ref<any>(null)
const rebaseFrom = ref('')
const rebaseTo = ref('')
const rebaseResult = ref<any>(null)

onMounted(async () => {
  try { libs.value = (await api('/api/libraries')) || [] } catch { /* 忽略 */ }
})

async function preview() {
  try {
    plan.value = await api('/api/adopt/preview', { method: 'POST', body: JSON.stringify({ libraryIds: selected.value }) })
    toast.ok(`预演完成：可接管 ${plan.value.adoptable.length}，对不上号 ${plan.value.missing.length}`)
  } catch (e: any) { toast.bad(e.message) }
}
function apply() {
  if (!confirm('执行接管？将把识别到的 STRM 内容替换为本站直链（路径与文件名不动，mtime 保留）。')) return
  submitTask(() => api('/api/adopt/apply', { method: 'POST', body: JSON.stringify({ libraryIds: selected.value }) }), '接管')
}
async function rebase() {
  if (!rebaseFrom.value || !rebaseTo.value) { toast.bad('填写旧地址与新地址'); return }
  try {
    rebaseResult.value = await api('/api/strm/rebase', { method: 'POST', body: JSON.stringify({ from: rebaseFrom.value, to: rebaseTo.value }) })
    toast.ok(`替换完成：扫描 ${rebaseResult.value.scanned}，替换 ${rebaseResult.value.changed}`)
  } catch (e: any) { toast.bad(e.message) }
}
</script>

<template>
  <h2 class="page-title">迁移</h2>

  <div class="card">
    <h3>接管其它工具的 STRM</h3>
    <p class="muted" style="font-size:13px">
      从 p115strmhelper / QMediaSync / OpenList 等换过来时使用：路径与文件名不动、只换直链，
      Emby 条目与观看记录全保留。执行前请先在「设置」填好播放地址。
    </p>
    <div class="row" style="margin-bottom:10px">
      <label class="row" style="gap:4px"><input type="checkbox" :checked="selected.length === libs.length && libs.length > 0"
        @change="selected = ($event.target as HTMLInputElement).checked ? libs.map(l => l.id) : []" /> 全选</label>
      <label v-for="l in libs" :key="l.id" class="row" style="gap:4px;font-size:13px">
        <input type="checkbox" :value="l.id" v-model="selected" /> {{ l.name }}
      </label>
    </div>
    <div class="row">
      <button class="btn ghost" @click="preview">预演</button>
      <button class="btn" @click="apply" :disabled="!plan?.adoptable?.length">执行接管</button>
    </div>
    <div v-if="plan" style="margin-top:12px">
      <div class="row" style="gap:18px;font-size:13px">
        <span>扫描 <b>{{ plan.scanned }}</b></span>
        <span>可接管 <b class="ok">{{ plan.adoptable.length }}</b></span>
        <span>已是本站 <b>{{ plan.skipped }}</b></span>
        <span>对不上号 <b class="warn">{{ plan.missing.length }}</b></span>
      </div>
      <div v-if="plan.adoptable.length" style="max-height:180px;overflow:auto;margin-top:8px">
        <div v-for="(it, i) in plan.adoptable" :key="i" class="muted" style="font-size:12px">
          [{{ it.kind }}] {{ it.foreign.rel }} → {{ it.file.pickcode }}
        </div>
      </div>
      <div v-if="plan.missing.length" class="warn" style="margin-top:8px;font-size:12px">
        对不上号（不在台账里，保持原样）：{{ plan.missing.map((m: any) => m.rel).slice(0, 10).join('、') }}…
      </div>
    </div>
  </div>

  <div class="card">
    <h3>STRM 地址批量替换</h3>
    <p class="muted" style="font-size:13px">直连域名填错或换 IP 后使用：扫描全部媒体库的 .strm，只替换首行开头的旧地址（保留 mtime，零网盘请求）。</p>
    <div class="row">
      <input v-model="rebaseFrom" placeholder="http://旧地址:2048" style="flex:1" />
      <span class="muted">→</span>
      <input v-model="rebaseTo" placeholder="http://新地址:2048" style="flex:1" />
      <button class="btn" @click="rebase">开始替换</button>
    </div>
    <div v-if="rebaseResult" class="ok" style="margin-top:8px;font-size:13px">
      扫描 {{ rebaseResult.scanned }} 个，替换 {{ rebaseResult.changed }} 个
    </div>
  </div>
</template>
