import { Capacitor } from '@capacitor/core'
import { bootstrapNativeAuthSession } from './services/backendSync.js'
import { isAndroidAuthPlatform } from './services/keepTimerAuth.js'
import { registerSW } from 'virtual:pwa-register'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './assets/main.css' // Tailwind burada yükleniyor

// A native bundle has its own lifecycle; don't let a PWA worker cache an older APK UI.
if (!Capacitor.isNativePlatform()) registerSW({ immediate: true })
else if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistration().then(registration => {
    if (registration?.active?.scriptURL === new URL('/sw.js', location.origin).href) return registration.unregister()
  }).catch(() => {})
}

const theme = localStorage.getItem('theme');
if (theme === 'dark') {
  document.documentElement.classList.add('dark');
}

// Offline UI can mount immediately; every authenticated network path waits for access.
if (isAndroidAuthPlatform()) void bootstrapNativeAuthSession()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
