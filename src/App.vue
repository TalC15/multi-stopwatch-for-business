<script setup>
import { RouterView } from "vue-router";
import { connectSocket } from './services/socket';
import { isLoggedIn } from './services/backendSync';
import AppMessage from "./components/ui/AppMessage.vue";
import { messageState } from "./composables/message.js";
import { onMounted, onUnmounted } from "vue";
import { useStopwatchStore } from "./stores/stopwatchStore.js";
const timers = useStopwatchStore();
import { initializeNotifications } from "./utils/notifications.js";
let cleanupNotifications;
onUnmounted(() => cleanupNotifications?.());
onMounted(() => {
  cleanupNotifications = initializeNotifications();
  void timers.initialize();
  // Socket bağlantısı
  if (isLoggedIn()) {
    connectSocket();
  }
});
</script>

<template>
  <RouterView></RouterView>
  <AppMessage :messages="messageState.messages" />
</template>
