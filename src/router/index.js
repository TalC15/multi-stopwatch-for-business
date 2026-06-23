import { createRouter, createWebHistory } from 'vue-router'
import { isLoggedIn } from '../services/backendSync'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
    meta: { guest: true } // sadece giriş yapmamışlar görebilir
  },
  {
    path: '/',
    name: 'Home',
    component: () => import('../views/HomeView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Auth guard
router.beforeEach((to, from) => {
  if (to.meta.requiresAuth && !isLoggedIn()) {
    return '/login'
  } else if (to.meta.guest && isLoggedIn()) {
    return '/'
  }
})

export default router