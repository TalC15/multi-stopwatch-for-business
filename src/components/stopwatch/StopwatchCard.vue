<template>
  <!-- COUNT-UP Card -->
  <div
    v-if="timer.type === 'up'"
    :class="[
      'rounded-2xl p-5 transition-all duration-500 relative overflow-hidden card-shadow',
      cardStyle.bg,
      cardStyle.border,
    ]"
  >
    <div class="flex justify-between items-start mb-1">
      <div>
        <h3 :class="['text-lg font-bold leading-tight', cardStyle.title]">{{ timer.name }}</h3>
        <p v-if="timer.targetMinutes" :class="['text-sm mt-0.5', cardStyle.subtitle]">
          Target: {{ String(timer.targetMinutes).padStart(2, '0') }}:00
        </p>
      </div>
      <span :class="['text-xs font-black px-3 py-1.5 rounded-full flex items-center gap-1.5', cardStyle.badge]">
        <span v-if="timer.status === 'running' && !timer.reachedTarget" class="w-2 h-2 rounded-full bg-current animate-pulse"></span>
        <span v-if="timer.reachedTarget">⚠</span>
        {{ statusLabel }}
      </span>
    </div>
 
    <div :class="['text-5xl font-black text-center py-4 tracking-tight tabular-nums', cardStyle.time]">
      {{ displayTime }}<span :class="['text-xl font-bold ml-0.5', cardStyle.centiseconds]">.{{ centiseconds }}</span>
    </div>
 
    <div :class="['w-full h-1.5 rounded-full mb-4', cardStyle.progressTrack]">
      <div
        :class="['h-full rounded-full transition-all duration-300', cardStyle.progressBar, timer.status === 'running' ? 'progress-running' : '']"
        :style="{ width: progressPercent + '%' }"
      ></div>
    </div>
    <div :class="['w-full h-px mb-4', cardStyle.divider]"></div>
 
    <div class="flex items-center gap-3">
      <button
        @click="toggleTimer"
        :class="['flex-1 py-3.5 rounded-2xl font-bold text-base transition-all active:scale-95 flex items-center justify-center gap-2', cardStyle.primaryBtn]"
      >
        <svg v-if="timer.status === 'running'" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
        </svg>
        <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z"/>
        </svg>
        {{ timer.status === 'running' ? 'Pause' : 'Start' }}
      </button>
      <button @click="store.deleteTimer(timer.id)" :class="['w-12 h-12 rounded-2xl flex items-center justify-center transition-colors', cardStyle.deleteBtn]">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
      <span :class="['text-sm font-semibold', cardStyle.deleteTxt]">Delete</span>
    </div>
  </div>
 
  <!-- COUNT-DOWN Card -->
  <div
    v-else
    :class="[
      'rounded-2xl p-5 transition-all duration-500 relative overflow-hidden',
      cardStyle.bg,
      cardStyle.border,
      timer.status === 'expired' ? 'card-shadow-finished' : 'card-shadow'
    ]"
  >
    <div class="flex justify-between items-start mb-4">
      <h3 :class="['text-lg font-bold leading-tight', cardStyle.title]">{{ timer.name }}</h3>
      <span :class="['text-xs font-black px-3 py-1.5 rounded-lg', cardStyle.badge]">
        {{ statusLabel }}
      </span>
    </div>
 
    <div :class="['text-5xl font-black text-center py-4 tracking-tight tabular-nums', cardStyle.time]">
      {{ displayTime }}
    </div>
 
    <div :class="['w-full h-1 rounded-full mb-1', cardStyle.progressTrack]">
      <div
        :class="['h-full rounded-full transition-all duration-300', cardStyle.progressBar]"
        :style="{ width: progressPercent + '%' }"
      ></div>
    </div>
    <div :class="['w-full h-px my-4', cardStyle.divider]"></div>
 
    <div class="flex items-center gap-3">
      <button @click="store.deleteTimer(timer.id)" :class="['w-10 h-10 flex items-center justify-center transition-colors', cardStyle.deleteBtn]">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
      <button
        v-if="timer.status !== 'expired'"
        @click="toggleTimer"
        :class="['flex-1 py-3.5 rounded-2xl font-bold text-base transition-all active:scale-95 flex items-center justify-center gap-2', cardStyle.primaryBtn]"
      >
        <svg v-if="timer.status === 'running'" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
        </svg>
        <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z"/>
        </svg>
        {{ timer.status === 'running' ? 'Pause' : 'Start' }}
      </button>
      <div v-else class="flex-1"></div>
    </div>
  </div>
</template>
 
<script setup>
import { computed } from 'vue';
import { useStopwatchStore } from '@/stores/stopwatchStore';
 
const props = defineProps(['timer']);
const store = useStopwatchStore();
 
const displayTime = computed(() => {
  let ms;
  if (props.timer.type === 'up') {
    ms = props.timer.elapsed || 0;
  } else {
    ms = props.timer.remaining ?? (props.timer.targetMinutes * 60 * 1000);
  }
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
});
 
const centiseconds = computed(() => {
  const ms = props.timer.elapsed || 0;
  return String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
});
 
const progressPercent = computed(() => {
  const total = (props.timer.targetMinutes || 1) * 60 * 1000;
  if (props.timer.type === 'up') {
    // %100'de sabit kalır, hedef aşıldıktan sonra bar dolup durur
    return Math.min(((props.timer.elapsed || 0) / total) * 100, 100);
  } else {
    const remaining = props.timer.remaining ?? total;
    return Math.max((remaining / total) * 100, 0);
  }
});
 
const statusLabel = computed(() => {
  const { status, type, reachedTarget } = props.timer;
  if (type === 'up') {
    if (reachedTarget && status === 'running') return 'TIME REACHED';
    if (reachedTarget && status === 'paused')  return 'TIME REACHED';
    if (status === 'running') return 'RUNNING';
    if (status === 'paused')  return 'PAUSED';
    return 'IDLE';
  }
  if (status === 'running') return 'RUNNING';
  if (status === 'paused')  return 'PAUSED';
  if (status === 'expired') return 'FINISHED';
  return 'IDLE';
});
 
const toggleTimer = () => {
  if (props.timer.status === 'running') {
    store.pauseTimer(props.timer.id);
  } else {
    store.startTimer(props.timer.id);
  }
};
 
const cardStyle = computed(() => {
  const { type, status, reachedTarget } = props.timer;
 
  if (type === 'up') {
    // Hedef aşıldı ama hâlâ çalışıyor/durduruldu → turuncu/amber tema
    if (reachedTarget) {
      return {
        bg: 'bg-amber-50 dark:bg-amber-950/30',
        border: 'ring-1 ring-amber-200 dark:ring-amber-800',
        title: 'text-amber-900 dark:text-amber-100',
        subtitle: 'text-amber-700 dark:text-amber-400',
        time: 'text-amber-900 dark:text-amber-100',
        centiseconds: 'text-amber-500 dark:text-amber-400',
        badge: 'bg-amber-800 text-white',
        progressTrack: 'bg-amber-200 dark:bg-amber-800',
        progressBar: 'bg-amber-700',
        divider: 'bg-amber-200 dark:bg-amber-800',
        primaryBtn: status === 'running'
          ? 'bg-amber-800 text-white hover:bg-amber-900'
          : 'bg-amber-700 text-white hover:bg-amber-800',
        deleteBtn: 'text-amber-700 hover:text-amber-900',
        deleteTxt: 'text-amber-700',
      };
    }
    // Normal
    return {
      bg: 'bg-white dark:bg-slate-800',
      border: 'ring-1 ring-slate-100 dark:ring-slate-700',
      title: 'text-slate-900 dark:text-white',
      subtitle: 'text-slate-500 dark:text-slate-400',
      time: 'text-slate-900 dark:text-white',
      centiseconds: 'text-slate-400 dark:text-slate-500',
      badge: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
      progressTrack: 'bg-slate-100 dark:bg-slate-700',
      progressBar: 'bg-indigo-700',
      divider: 'bg-slate-100 dark:bg-slate-700',
      primaryBtn: 'bg-indigo-700 text-white hover:bg-indigo-800',
      deleteBtn: 'text-red-500 hover:text-red-700',
      deleteTxt: 'text-red-500',
    };
  }
 
  // COUNT-DOWN expired
  if (status === 'expired') {
    return {
      bg: 'bg-red-100 dark:bg-red-950/30',
      border: 'ring-2 ring-red-300 dark:ring-red-800',
      title: 'text-red-800 dark:text-red-200',
      subtitle: 'text-red-600',
      time: 'text-red-700 dark:text-red-300',
      centiseconds: 'text-red-400',
      badge: 'bg-red-200 dark:bg-red-900 text-red-800 dark:text-red-200',
      progressTrack: 'bg-red-200 dark:bg-red-900',
      progressBar: 'bg-red-400',
      divider: 'bg-red-200 dark:bg-red-800',
      primaryBtn: 'bg-red-700 text-white hover:bg-red-800',
      deleteBtn: 'text-red-600 hover:text-red-800',
      deleteTxt: 'text-red-600',
    };
  }
 
  // COUNT-DOWN normal
  return {
    bg: 'bg-white dark:bg-slate-800',
    border: 'ring-1 ring-slate-100 dark:ring-slate-700',
    title: 'text-slate-900 dark:text-white',
    subtitle: 'text-slate-500',
    time: 'text-slate-900 dark:text-white',
    centiseconds: 'text-slate-400',
    badge: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
    progressTrack: 'bg-slate-100 dark:bg-slate-700',
    progressBar: 'bg-indigo-700',
    divider: 'bg-slate-100 dark:bg-slate-700',
    primaryBtn: 'bg-indigo-700 text-white hover:bg-indigo-800',
    deleteBtn: 'text-red-500 hover:text-red-700',
    deleteTxt: 'text-red-500',
  };
});
</script>