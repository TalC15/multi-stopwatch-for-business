import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'
 
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      workbox: {
        // App navigation must reopen offline; asset/API requests are unaffected.
        navigateFallback: "/index.html",
        importScripts: ['/notification-events.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,mp3,woff2}'],
        // Alarm sounds are precached too, so the first offline alarm can play.
        runtimeCaching: [],
      },
      manifest: {
        name: 'KeepTime',
        short_name: 'KeepTime',
        description: 'Ticari zamanlayıcı uygulaması',
        theme_color: '#ffffff',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        lang: 'tr',
        icons: [
          {
            src: '/icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
 
