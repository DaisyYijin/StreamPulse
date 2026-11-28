import { createRouter, createWebHashHistory } from 'vue-router'
import { getToken } from './api'
import Login from './pages/Login.vue'
import Dashboard from './pages/Dashboard.vue'
import Account from './pages/Account.vue'
import Libraries from './pages/Libraries.vue'
import Sync from './pages/Sync.vue'
import Migrate from './pages/Migrate.vue'
import DeepDel from './pages/DeepDel.vue'
import ScrapePage from './pages/Scrape.vue'
import Tasks from './pages/Tasks.vue'
import Settings from './pages/Settings.vue'

// hash 路由:单文件嵌入后无需服务端 SPA 回退
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: Login, meta: { public: true } },
    { path: '/', component: Dashboard },
    { path: '/account', component: Account },
    { path: '/libraries', component: Libraries },
    { path: '/sync', component: Sync },
    { path: '/migrate', component: Migrate },
    { path: '/deepdel', component: DeepDel },
    { path: '/scrape', component: ScrapePage },
    { path: '/tasks', component: Tasks },
    { path: '/settings', component: Settings },
  ],
})

router.beforeEach((to) => {
  if (!to.meta.public && !getToken()) {
    return '/login'
  }
})
