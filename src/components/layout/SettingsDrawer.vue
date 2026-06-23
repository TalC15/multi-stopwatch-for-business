<script setup>
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { useThemeStore } from "@/stores/themeStore";
import { saveTelegramChatId } from '@/services/backendSync';

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
    <div
      class="absolute inset-y-0 left-0 w-72 bg-[var(--color-card)] shadow-xl transition-transform p-6"
    >
      <!-- Header -->
      <div class="flex justify-between items-center mb-8">
        <h2 class="text-xl font-bold text-[var(--color-text-primary)]">
          Ayarlar
        </h2>
        <button
          @click="$emit('close')"
          class="w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div class="space-y-6">
        <!-- Dark Mode Toggle -->
        <div class="flex justify-between items-center py-3">
          <div class="flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-lg bg-[var(--color-primary-bg)] flex items-center justify-center"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 text-[var(--color-primary-light)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            </div>
            <span class="font-medium text-[var(--color-text-primary)]"
              >Koyu Tema</span
            >
          </div>
          <button
            @click="themeStore.toggleTheme()"
            :class="[
              'w-12 h-7 rounded-full relative transition-colors duration-300',
              themeStore.isDark
                ? 'bg-[var(--color-primary-light)]'
                : 'bg-[var(--color-border)]',
            ]"
          >
            <div
              :class="[
                'absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-300',
                themeStore.isDark
                  ? 'translate-x-5 left-0.5'
                  : 'translate-x-0 left-0.5',
              ]"
            ></div>
          </button>
        </div>

        <div class="flex flex-col gap-3">
          <RouterLink
            to="/settings"
            class="flex items-center gap-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-400/30 rounded-xl px-4 py-2.5 text-indigo-300 text-sm font-medium transition-colors"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path
                d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
              />
            </svg>
            Ayarlar
          </RouterLink>
          <RouterLink
            to="/"
            class="flex items-center gap-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-400/30 rounded-xl px-4 py-2.5 text-indigo-300 text-sm font-medium transition-colors"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            Panel
          </RouterLink>
        </div>

        <!-- Divider -->
        <div class="border-t border-[var(--color-border)]"></div>

        <!-- Version -->
        <p class="text-xs text-[var(--color-text-muted)]">Versiyon 1.0.0</p>
      </div>
    </div>
  </div>
</template>
