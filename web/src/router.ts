import { createRouter, createWebHashHistory } from 'vue-router'
import { getToken } from './api'
import Home from './pages/Home.vue'
import Login from './pages/Login.vue'

// hash 路由:单文件嵌入后无需服务端 SPA 回退
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: Login, meta: { public: true } },
    { path: '/', component: Home },
  ],
})

router.beforeEach((to) => {
  if (!to.meta.public && !getToken()) {
    return '/login'
  }
})
