<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, clearToken } from './api'
import { useToast } from './stores/ui'
import Icon from './components/Icon.vue'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const collapsed = ref(false)

const groups = [
  {
    label: '总览', icon: 'home', to: '/', children: null,
  },
  {
    label: '账号', icon: 'user', to: '/account', children: null,
  },
  {
    label: '媒体库', icon: 'layers', to: '/libraries', children: null,
  },
  {
    label: '数据同步', icon: 'sync', to: '/sync',
    children: [
      { label: '全量同步', to: '/sync' },
      { label: '同步记录', to: '/tasks' },
    ],
  },
  { label: '迁移接管', icon: 'transfer', to: '/migrate', children: null },
  { label: '深删记录', icon: 'trash', to: '/deepdel', children: null },
  { label: '刮削', icon: 'spark', to: '/scrape', children: null },
  { label: '设置', icon: 'gear', to: '/settings', children: null },
]

const openMap = ref<Record<string, boolean>>({})
const isPublic = computed(() => !!route.meta.public)

// 进入子页时自动展开对应分组
watch(() => route.path, (p) => {
  for (const g of groups) {
    if (g.children && (p === g.to || g.children.some((c: any) => c.to === p))) {
      openMap.value[g.label] = true
    }
  }
}, { immediate: true })

function isActive(to: string) {
  if (to === '/') return route.path === '/'
  return route.path === to
}
function groupActive(g: any) {
  return g.children
    ? g.children.some((c: any) => c.to === route.path)
    : isActive(g.to)
}

async function logout() {
  try { await api('/api/logout', { method: 'POST' }) } catch { /* 忽略 */ }
  clearToken()
  router.push('/login')
}
</script>

<template>
  <router-view v-if="isPublic" />
  <div v-else class="layout">
    <aside class="side" :class="{ collapsed }">
      <div class="logo">
        <button class="collapse-btn" @click="collapsed = !collapsed">
          <Icon name="menu" :size="16" />
        </button>
        <span class="mark">SP</span>
        <span class="sub">Stream Media<br/>Sync</span>
      </div>
      <nav class="menu">
        <div v-for="g in groups" :key="g.label" class="group"
             :class="{ open: openMap[g.label] }">
          <router-link v-if="!g.children" :to="g.to" class="group-head"
                       :class="{ active: groupActive(g) }">
            <Icon :name="g.icon" />
            <span class="group-label">{{ g.label }}</span>
          </router-link>
          <template v-else>
            <div class="group-head" :class="{ active: groupActive(g) }"
                 @click="openMap[g.label] = !openMap[g.label]">
              <Icon :name="g.icon" />
              <span class="group-label">{{ g.label }}</span>
              <span class="chev">▾</span>
            </div>
            <div class="sub-menu">
              <router-link v-for="c in g.children" :key="c.to" :to="c.to"
                           :class="{ active: isActive(c.to) }">{{ c.label }}</router-link>
            </div>
          </template>
        </div>
      </nav>
      <div class="foot">
        <button class="btn ghost small" style="width:100%" @click="logout">
          <span class="group-label">退出登录</span>
        </button>
      </div>
    </aside>
    <main class="main">
      <router-view />
    </main>
  </div>
  <div v-if="toast.text" class="toast" :class="{ err: toast.err }">{{ toast.text }}</div>
</template>
