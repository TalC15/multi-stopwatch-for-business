<script setup>
import { computed, useId } from 'vue';
import { Capacitor } from '@capacitor/core';
import { accountExperience } from '../services/accountExperience.js';
import { soundSettings as settings, notificationState, updateSoundSettings,
  testAlarm, stopAllAlarmSounds } from '../utils/notifications.js';
const id = useId();
const android = Capacitor.getPlatform() === 'android';
const muted = computed(() => (!settings.speechEnabled || settings.speechVolume === 0)
  && (!settings.alarmEnabled || settings.alarmVolume === 0));
const controls = [
  { enabled: 'speechEnabled', volume: 'speechVolume', title: 'Sesli okuma',
    description: 'Sayaç adını ve güncel ödeme durumunu beş tur okur.' },
  { enabled: 'alarmEnabled', volume: 'alarmVolume', title: 'Alarm sesi',
    description: 'Sesli okumayla beraber alarm da çalar. Sesli okuma kapalıysa alarm bir tur çalar.' },
];
function volumeChanged(key, event, persist) {
  updateSoundSettings({ [key]: Number(event.target.value) }, persist);
}
</script>
<template>
  <section id="sound-settings" :aria-labelledby="`${id}-title`" class="mb-5">
    <div class="mb-3 ml-1">
      <h2 :id="`${id}-title`" class="text-base font-black tracking-tight">Ses ayarları</h2>
    </div>
    <div class="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm">
      <div v-for="control in controls" :key="control.enabled" class="border-b border-[var(--color-border)] px-5 py-4 sm:px-6">
        <div class="flex items-center justify-between gap-3">
          <label :for="`${id}-${control.enabled}`" class="text-sm font-bold">{{ control.title }}</label>
          <div class="flex shrink-0 items-center gap-2">
            <span class="text-xs text-[var(--color-text-secondary)]">{{ settings[control.enabled] ? 'Açık' : 'Kapalı' }}</span>
            <input :id="`${id}-${control.enabled}`" type="checkbox" role="switch"
              :disabled="control.enabled === 'speechEnabled' && !accountExperience.canFeature('tts')"
              :checked="settings[control.enabled]" :aria-describedby="`${id}-${control.enabled}-hint`"
              class="size-5 cursor-pointer accent-indigo-600"
              @change="updateSoundSettings({ [control.enabled]: $event.target.checked })" />
          </div>
        </div>
        <p :id="`${id}-${control.enabled}-hint`" class="mt-1.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">{{ control.description }}</p>
        <p v-if="control.enabled === 'speechEnabled' && !accountExperience.canFeature('tts')" class="mt-2 text-xs leading-5 text-text-secondary">Sesli okuma için doğrulanmış kullanım hakkı gerekir. Normal alarm sesiniz kullanılabilir.</p>
        <div class="mt-4" :class="{ 'opacity-50': !settings[control.enabled] }">
          <div class="mb-2 flex items-center justify-between text-xs">
            <label :for="`${id}-${control.volume}`">{{ control.title }} düzeyi</label>
            <output :for="`${id}-${control.volume}`" class="font-semibold tabular-nums">%{{ settings[control.volume] }}</output>
          </div>
          <input :id="`${id}-${control.volume}`" type="range" min="0" max="100" step="5"
            :value="settings[control.volume]" :disabled="!settings[control.enabled] || control.enabled === 'speechEnabled' && !accountExperience.canFeature('tts')"
            :aria-valuetext="`Yüzde ${settings[control.volume]}`"
            class="w-full cursor-pointer accent-indigo-600 disabled:cursor-not-allowed"
            @input="volumeChanged(control.volume, $event, false)"
            @change="volumeChanged(control.volume, $event, true)" />
        </div>
      </div>
      <div class="px-5 py-4 sm:px-6">
        <p class="text-xs leading-relaxed text-[var(--color-text-secondary)]">Sesi kapatmak zamanlayıcıları veya bildirimleri engellenemez.</p>
        <p v-if="android" class="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
          Ses düzeyleri uygulama açıkken geçerlidir. Arka plan alarmının düzeyi Android bildirim ayarından yönetilir; alarmı burada kapatmak arka plan bildirimini de sessize alır.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" :disabled="notificationState.testing || muted"
            class="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" @click="testAlarm">
            {{ notificationState.testing ? 'Ses deneniyor…' : 'Seçili sesleri dene' }}
          </button>
          <button type="button" class="rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm font-semibold" @click="stopAllAlarmSounds">
            Çalan sesleri sustur
          </button>
        </div>
        <p v-if="muted" role="status" class="mt-3 text-xs text-[var(--color-text-secondary)]">Tüm uygulama sesleri kapalı.</p>
        <p v-if="notificationState.error" role="alert" class="mt-3 text-xs text-red-500">{{ notificationState.error }}</p>
      </div>
    </div>
  </section>
</template>
