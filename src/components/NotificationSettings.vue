<script setup>
import { computed, onMounted } from 'vue';
import { Capacitor } from '@capacitor/core';
import { notificationState as state, refreshNotificationStatus, requestNotificationPermission,
  requestExactAlarmPermission } from '../utils/notifications.js';
const android = Capacitor.getPlatform() === 'android';
const native = Capacitor.isNativePlatform();
const permissionText = computed(() => ({ granted: 'Bildirim izni açık', denied: 'Bildirim izni kapalı',
  default: 'Bildirim izni bekleniyor', prompt: 'Bildirim izni bekleniyor',
  'prompt-with-rationale': 'Bildirim izni bekleniyor', unsupported: 'Bu tarayıcıda bildirim desteklenmiyor',
  unknown: 'İzin durumu kontrol ediliyor' }[state.permission] || 'Bildirim izni bekleniyor'));
onMounted(refreshNotificationStatus);
</script>
<template>
  <section aria-labelledby="alarm-settings-title" class="mb-6 rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm">
    <div class="flex items-center gap-3 mb-4">
      <img src="/icons/notification-logo.png" alt="" width="44" height="44" class="rounded-xl" />
      <div>
        <h2 id="alarm-settings-title" class="font-bold">Cihaz Bildirimleri</h2>
        <p class="text-xs text-[var(--color-text-secondary)]">Her cihazda çalışmaz ve sadece cihaz sahibine zamanlayıcı bitince bildirim gönderilir.</p>
      </div>
    </div>
    <p role="status" class="text-sm font-medium">{{ permissionText }}</p>
    <p v-if="state.permission === 'denied'" class="mt-2 text-xs text-[var(--color-text-secondary)]">
      {{ native ? 'Cihaz ayarlarından KeepTimer bildirimlerine izin verin.' : 'Tarayıcının site ayarlarından bildirim iznini açın.' }}
    </p>
    <div class="mt-4 flex flex-wrap gap-2">
      <button v-if="state.permission !== 'granted' && state.permission !== 'unsupported'" type="button"
        class="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white" @click="requestNotificationPermission">
        Bildirimleri etkinleştir
      </button>
      <button v-if="android && state.exact !== 'granted'" type="button"
        class="rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm" @click="requestExactAlarmPermission">
        Kesin alarm izni
      </button>
    </div>
    <p v-if="state.error" role="alert" class="mt-3 text-xs text-red-500">{{ state.error }}</p>
  </section>
</template>
