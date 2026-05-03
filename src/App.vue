<script setup>
import { ref, computed, onMounted } from 'vue';
import { useStopwatchStore } from '@/stores/stopwatchStore';
import { useThemeStore } from '@/stores/themeStore';
import Navbar from '@/components/layout/Navbar.vue';
import SettingsDrawer from '@/components/layout/SettingsDrawer.vue';
import StopwatchCard from '@/components/stopwatch/StopwatchCard.vue';
import AddModal from '@/components/stopwatch/AddModal.vue';
 
const store = useStopwatchStore();
const themeStore = useThemeStore();
 
const activeTab = ref('up');
const isDrawerOpen = ref(false);
const isModalOpen = ref(false);
 
const filteredTimers = computed(() =>
  store.stopwatches.filter(t => t.type === activeTab.value)
);
 
onMounted(() => themeStore.applyTheme());
</script>
 
<template>
  <div :class="['min-h-screen bg-[var(--color-surface)] transition-colors duration-300', themeStore.isDark ? 'dark' : '']">
 
    <!-- Navbar -->
    <Navbar @open-menu="isDrawerOpen = true" />
 
    <!-- Settings Drawer -->
    <SettingsDrawer :isOpen="isDrawerOpen" @close="isDrawerOpen = false" />
 
    <!-- Main Content -->
    <main class="max-w-md mx-auto px-4 pt-6 pb-32">
 
      <!-- Page Header -->
      <div class="flex justify-between items-center mb-5">
        <h2 class="text-2xl font-black text-[var(--color-text-primary)]">
          {{ activeTab === 'up' ? 'Active Timers' : 'Active Countdowns' }}
        </h2>
        <button
          v-if="activeTab === 'up'"
          class="flex items-center gap-1.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          Filter
        </button>
      </div>
 
      <!-- Timer Cards -->
      <div class="space-y-4">
        <StopwatchCard
          v-for="timer in filteredTimers"
          :key="timer.id"
          :timer="timer"
          
        />
 
        <!-- Empty State -->
        <div
          v-if="filteredTimers.length === 0"
          class="flex flex-col items-center justify-center py-20 text-center"
        >
          <div class="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center mb-4">
            <svg class="w-8 h-8 text-indigo-300 dark:text-indigo-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p class="text-sm font-semibold text-[var(--color-text-muted)]">
            {{ activeTab === 'up' ? 'No active timers' : 'No active countdowns' }}
          </p>
          <p class="text-xs text-[var(--color-text-muted)] mt-1">Tap + to add one</p>
        </div>
      </div>
    </main>
 
    <!-- FAB Button -->
    <button
      @click="isModalOpen = true"
      class="fixed bottom-24 right-5 w-14 h-14 bg-indigo-700 text-white rounded-2xl fab-shadow flex items-center justify-center text-3xl font-light hover:bg-indigo-800 active:scale-90 transition-all z-40"
      aria-label="Yeni ekle"
    >
      +
    </button>
 
    <!-- Bottom Tab Bar -->
    <nav class="fixed bottom-0 left-0 right-0 z-30 bg-[var(--color-card)] border-t border-[var(--color-border)]">
      <div class="max-w-md mx-auto flex">
 
        <!-- Count-Up Tab -->
        <button
          @click="activeTab = 'up'"
          :class="[
            'flex-1 py-3 flex flex-col items-center gap-1 transition-colors',
            activeTab === 'up'
              ? 'text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30'
              : 'text-[var(--color-text-muted)]'
          ]"
        >
          <!-- Stopwatch icon with number -->
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-[10px] font-black tracking-wider uppercase">Count-Up</span>
        </button>
 
        <!-- Count-Down Tab -->
        <button
          @click="activeTab = 'down'"
          :class="[
            'flex-1 py-3 flex flex-col items-center gap-1 transition-colors',
            activeTab === 'down'
              ? 'text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30'
              : 'text-[var(--color-text-muted)]'
          ]"
        >
          <!-- Hourglass icon -->
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-[10px] font-black tracking-wider uppercase">Countdown</span>
        </button>
 
      </div>
    </nav>
 
    <!-- Add Modal -->
    <AddModal
      :isOpen="isModalOpen"
      :defaultType="activeTab"
      @close="isModalOpen = false"
    />
 
  </div>
</template>