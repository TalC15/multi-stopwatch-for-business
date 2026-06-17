import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './assets/main.css' // Tailwind burada yükleniyor

const theme = localStorage.getItem('theme');
if (theme === 'dark') {
  document.documentElement.classList.add('dark');
}

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
