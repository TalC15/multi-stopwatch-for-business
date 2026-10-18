<script setup>
import { RouterView } from "vue-router";
import { connectSocket } from './services/socket';
import { isLoggedIn, getUser } from './services/backendSync';
import { isAndroidAuthPlatform } from './services/keepTimerAuth.js';
import AppMessage from "./components/ui/AppMessage.vue";
import { messageState } from "./composables/message.js";
import { onMounted, onUnmounted } from "vue";
import { useStopwatchStore } from "./stores/stopwatchStore.js";
const timers = useStopwatchStore();
import { accountExperience } from './services/accountExperience.js';
let stopAccountRenewal;
import { initializeNotifications } from "./utils/notifications.js";
let cleanupNotifications;
onUnmounted(() => { cleanupNotifications?.(); stopAccountRenewal?.(); accountExperience.dispose(); });
onMounted(() => {
  stopAccountRenewal = accountExperience.start();
  cleanupNotifications = initializeNotifications();
  if (['agent', 'superadmin'].includes(getUser()?.role)) return;
  void timers.initialize();
  // Socket bağlantısı
  // Native cold start expresses connection intent; connectSocket still awaits access.
  if (isLoggedIn() || isAndroidAuthPlatform()) {
    connectSocket();
  }
});
</script>

<template>
  <RouterView></RouterView>
  <AppMessage :messages="messageState.messages" />
</template>
