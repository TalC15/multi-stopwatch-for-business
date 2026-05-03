import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path' // Bu satırı ekle
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({
  plugins: [
    vue(),
     VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'KeepTime',
        short_name: 'App',
        description: 'Benim Vue uygulamam',
        theme_color: '#ffffff',
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
      '@': path.resolve(__dirname, './src'), // @ işaretini src klasörüne yönlendirir
    },
  },
})
