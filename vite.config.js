import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'
 
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Service Worker ses API'lerini engellemsin diye
        // navigateFallback'i kapat
        navigateFallback: null,
        // Ses dosyaları ve API çağrıları SW'dan geçmesin
        runtimeCaching: [],
      },
      manifest: {
        name: 'KeepTime',
        short_name: 'KeepTime',
        description: 'Ticari zamanlayıcı uygulaması',
        theme_color: '#ffffff',
        // Ses izni için gerekli
        permissions: ['notifications'],
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
 
