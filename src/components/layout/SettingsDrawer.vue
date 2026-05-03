<script setup>
import { useThemeStore } from '@/stores/themeStore';
const props = defineProps(['isOpen']);
defineEmits(['close']);
const themeStore = useThemeStore();
</script>
 
<template>
  <div v-if="isOpen" class="fixed inset-0 z-50 overflow-hidden">
    <!-- Backdrop -->
    <div
      @click="$emit('close')"
      class="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
    ></div>
 
    <!-- Drawer Panel -->
    <div class="absolute inset-y-0 left-0 w-72 bg-[var(--color-card)] shadow-xl transition-transform p-6">
      <!-- Header -->
      <div class="flex justify-between items-center mb-8">
        <h2 class="text-xl font-bold text-[var(--color-text-primary)]">Ayarlar</h2>
        <button
          @click="$emit('close')"
          class="w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
 
      <div class="space-y-6">
        <!-- Dark Mode Toggle -->
        <div class="flex justify-between items-center py-3">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-[var(--color-primary-bg)] flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-[var(--color-primary-light)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            </div>
            <span class="font-medium text-[var(--color-text-primary)]">Koyu Tema</span>
          </div>
          <button
            @click="themeStore.toggleTheme()"
            :class="[
              'w-12 h-7 rounded-full relative transition-colors duration-300',
              themeStore.isDark ? 'bg-[var(--color-primary-light)]' : 'bg-[var(--color-border)]'
            ]"
          >
            <div
              :class="[
                'absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-300',
                themeStore.isDark ? 'translate-x-5 left-0.5' : 'translate-x-0 left-0.5'
              ]"
            ></div>
          </button>
        </div>
 
        <!-- Divider -->
        <div class="border-t border-[var(--color-border)]"></div>
 
        <!-- Version -->
        <p class="text-xs text-[var(--color-text-muted)]">Versiyon 1.0.0</p>
      </div>
    </div>
  </div>
</template>