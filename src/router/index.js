import { createRouter, createWebHistory } from 'vue-router'
import { isLoggedIn,getUser } from '../services/backendSync'

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
  },
  {
  path: '/manager',
  name: 'Manager',
  component: () => import('../views/ManagerView.vue'),
  meta: { requiresAuth: true, requiresRole: ['manager', 'superadmin'] }
},
{
  path: '/superadmin',
  name: 'SuperAdmin',
  component: () => import('../views/SuperAdminView.vue'),
  meta: { requiresAuth: true, requiresRole: ['superadmin'] }
},
{
  path: '/profile',
  name: 'Profile',
  component: () => import('../views/ProfileView.vue'),
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
  } else if (to.meta.requiresRole) {
    const user = getUser()
    if (!user || !to.meta.requiresRole.includes(user.role)) {
      return '/'
    }
  }
})
export default router