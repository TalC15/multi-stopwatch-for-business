import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { message } from '../composables/message'; 

export const useStopwatchStore = defineStore('stopwatch', () => {
  const stopwatches = ref(JSON.parse(localStorage.getItem('timers')) || [])
  const presetTimes = ref(JSON.parse(localStorage.getItem('presetTimes')) || [])
  const presetNames = ref(JSON.parse(localStorage.getItem('presetNames')) || [])
  const duration = ref(JSON.parse(localStorage.getItem('defaultDuration')))
  const name = ref(JSON.parse(localStorage.getItem('defaultName')))
  watch(stopwatches, (val) => {
    localStorage.setItem('timers', JSON.stringify(val));
  }, { deep: true });

  // ─── Tick ────────────────────────────────────────────────────────────────
  let tickInterval = null;
  
  const startTick = () => {
    if (tickInterval) return;
    tickInterval = setInterval(() => {
      const now = Date.now();
      stopwatches.value.forEach(timer => {
        if (timer.status !== 'running') return;
        const elapsed = timer.accumulatedTime + (now - timer.startTime);
 
        if (timer.type === 'up') {
          timer.elapsed = elapsed;
          // Hedef aşıldıysa sadece görsel flag — sayaç DURMAZ, running kalır
          if (timer.targetMinutes && elapsed >= timer.targetMinutes * 60 * 1000) {
            timer.reachedTarget = true;
          }
        } else {
          // Count-down
          const total = timer.targetMinutes * 60 * 1000;
          const remaining = total - elapsed;
          if (remaining <= 0) {
            timer.remaining = 0;
            timer.elapsed = total;
            timer.status = 'expired';
            timer.startTime = null;
            timer.accumulatedTime = total;
          } else {
            timer.remaining = remaining;
            timer.elapsed = elapsed;
          }
        }
      });
 
      const anyRunning = stopwatches.value.some(t => t.status === 'running');
      if (!anyRunning) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
    }, 100);
  };
 
  const stopTick = () => {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  };
 
  // ─── Actions ──────────────────────────────────────────────────────────────
 
  const addTimer = (timer) => {
    const targetMs = timer.duration * 60 * 1000;
    stopwatches.value.push({
      id: crypto.randomUUID(),
      name: timer.name,
      targetMinutes: timer.duration,
      type: timer.type,
      status: 'idle',
      startTime: null,
      accumulatedTime: 0,
      elapsed: 0,
      remaining: timer.type === 'down' ? targetMs : null,
      reachedTarget: false, // count-up için görsel uyarı flag'i
    });
  };
 
  const startTimer = (id) => {
    const timer = stopwatches.value.find(t => t.id === id);
    // count-down expired ise başlatma, count-up her zaman başlatılabilir
    if (!timer) return;
    if (timer.type === 'down' && timer.status === 'expired') return;
    timer.startTime = Date.now();
    timer.status = 'running';
    startTick();
  };
 
  const pauseTimer = (id,pausedCount) => {
    const timer = stopwatches.value.find(t => t.id === id);
    if (timer && timer.status === 'running') {
      timer.accumulatedTime += Date.now() - timer.startTime;
      timer.startTime = null;
      timer.status = 'paused';
      pausedCount++
      localStorage.setItem(`pausedCount${id}`,JSON.stringify(pausedCount))
    }
  };
 
  const deleteTimer = (timer,deger) => {
    stopwatches.value = stopwatches.value.filter(t => t.id !== timer.id);
    localStorage.removeItem(`isPay${timer.id}`)
    localStorage.removeItem(`pausedCount${timer.id}`)
    message.success(`${timer.name} ${deger} silindi`)

  };
 
  // ─── Rehydrate (PWA crash/close recovery) ────────────────────────────────
  const rehydrateTimers = () => {
    const now = Date.now();
    stopwatches.value.forEach(timer => {
      if (timer.status === 'running' && timer.startTime) {
        const missedTime = now - timer.startTime;
        timer.accumulatedTime += missedTime;
        timer.startTime = null;
 
        if (timer.type === 'up') {
          timer.elapsed = timer.accumulatedTime;
          if (timer.targetMinutes && timer.elapsed >= timer.targetMinutes * 60 * 1000) {
            timer.reachedTarget = true;
          }
          // count-up durmaz, paused'a al
          timer.status = 'paused';
        } else {
          const total = timer.targetMinutes * 60 * 1000;
          const remaining = total - timer.accumulatedTime;
          if (remaining <= 0) {
            timer.remaining = 0;
            timer.elapsed = total;
            timer.status = 'expired';
          } else {
            timer.remaining = remaining;
            timer.elapsed = timer.accumulatedTime;
            timer.status = 'paused';
          }
        }
      }
    });
  };
 
  rehydrateTimers();
 
  return {
    stopwatches,
    presetTimes,
    presetNames,
    duration,
    name,
    addTimer,
    startTimer,
    pauseTimer,
    deleteTimer,
    startTick,
    stopTick,
  };
});