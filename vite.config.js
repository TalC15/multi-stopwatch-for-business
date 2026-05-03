import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path' // Bu satırı ekle

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // @ işaretini src klasörüne yönlendirir
    },
  },
})


/*import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // @ işaretini src klasörüne yönlendirir
    },
  },
})*/
