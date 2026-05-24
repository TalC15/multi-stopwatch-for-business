<script setup>
import { ref,computed } from 'vue';
import { useStopwatchStore } from '@/stores/stopwatchStore';
 
const props = defineProps(['isOpen', 'defaultType']);
const emit = defineEmits(['close']);
const store = useStopwatchStore();
 
const name = ref('');
const duration = ref(5);
const presetTimes = store.presetTimes
const presetNames = store.presetNames

const selectPresetTime = (val) => {
  duration.value = val;
};

const selectPresetName = (val) => {
  name.value = val;
}
 
const decrement = () => {
  if (duration.value > 1) duration.value--;
};
 
const increment = () => {
  duration.value++;
};
 
const save = () => {
  if (!name.value) return;
  store.addTimer({
    name: name.value,
    duration: duration.value,
    type: props.defaultType
  });
  name.value = '';
  duration.value = 25;
  emit('close')
  const createdTimerId = store.stopwatches[store.stopwatches.length-1].id
  store.startTimer(createdTimerId)
};
</script>
 
<template>
  <div v-if="isOpen" class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
    <!-- Backdrop -->
    <div
      @click="emit('close')"
      class="absolute inset-0 bg-black/60 backdrop-blur-md"
    ></div>
 
    <!-- Modal Panel -->
    <div class="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl p-7 shadow-2xl">
 
      <!-- Header -->
      <div class="flex justify-between items-center mb-6 pb-5 border-b border-slate-100 dark:border-slate-800">
        <h2 class="text-2xl font-black text-slate-900 dark:text-white">New Stopwatch</h2>
        <button
          @click="emit('close')"
          class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
 
      <div class="space-y-6">
 
        <!-- Name Input -->
        <div>
          <label class="block text-sm font-bold text-slate-500 dark:text-slate-400 mb-2">
            Stopwatch Name
          </label>
          <input
            v-model="name"
            type="text"
            placeholder="e.g., Presentation Prep"
            class="w-full px-4 py-3.5 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 border-none outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 text-base font-medium transition-all"
          />
        </div>
        <!-- Quick presetNames -->
        <div class="flex gap-3">
          <button
            v-for="presetName in presetNames"
            :key="presetName"
            @click="selectPresetName(presetName)"
            :class="[
              'flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 border',
              name === presetName
                ? 'bg-indigo-700 text-white border-indigo-700'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
            ]"
          >
            {{ presetName }}
          </button>
        </div>
 
        <!-- Duration Stepper -->
        <div>
          <div class="flex justify-between items-center mb-2">
            <label class="text-sm font-bold text-slate-500 dark:text-slate-400">
              Target Duration
            </label>
            <span class="text-sm font-semibold text-slate-400 dark:text-slate-500">Minutes</span>
          </div>
 
          <div class="flex items-center bg-indigo-50 dark:bg-slate-800 rounded-2xl p-2 gap-2">
            <!-- Minus -->
            <button
              @click="decrement"
              class="w-12 h-12 bg-indigo-100 dark:bg-slate-700 rounded-xl flex items-center justify-center text-slate-700 dark:text-white font-bold text-xl hover:bg-indigo-200 dark:hover:bg-slate-600 active:scale-90 transition-all"
            >
              −
            </button>
 
            <!-- Value -->
            <div class="flex-1 text-center">
              <input
                v-model.number="duration"
                type="number"
                min="1"
                class="w-full text-center bg-transparent text-4xl font-black text-slate-900 dark:text-white outline-none tabular-nums"
              />
            </div>
 
            <!-- Plus -->
            <button
              @click="increment"
              class="w-12 h-12 bg-indigo-100 dark:bg-slate-700 rounded-xl flex items-center justify-center text-slate-700 dark:text-white font-bold text-xl hover:bg-indigo-200 dark:hover:bg-slate-600 active:scale-90 transition-all"
            >
              +
            </button>
          </div>
        </div>
 
        <!-- Quick presetTimes -->
        <div class="flex gap-3">
          <button
            v-for="presetTime in presetTimes"
            :key="presetTime"
            @click="selectPresetTime(presetTime)"
            :class="[
              'flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 border',
              duration === presetTime
                ? 'bg-indigo-700 text-white border-indigo-700'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
            ]"
          >
            {{ presetTime }} MIN
          </button>
        </div>
 
      </div>
 
      <!-- Create Button -->
      <button
        @click="save"
        :disabled="!name"
        class="w-full mt-7 py-4 bg-indigo-700 hover:bg-indigo-800 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-600 text-white rounded-2xl font-black text-lg shadow-lg shadow-indigo-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Create Stopwatch
      </button>
    </div>
  </div>
</template>