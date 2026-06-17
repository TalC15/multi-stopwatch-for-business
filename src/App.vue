<script setup>
import { RouterView } from "vue-router";
import AppMessage from "./components/ui/AppMessage.vue";
import { messageState } from "./composables/message.js";
import { onMounted } from "vue";
import { requestNotificationPermission } from "./utils/notifications";
import { useStopwatchStore } from "./stores/stopwatchStore.js";
import { LocalNotifications } from "@capacitor/local-notifications";
const store = useStopwatchStore()
// PWA'da speechSynthesis'i kullanıcı etkileşimiyle uyandır
// Bu olmadan PWA/production modda ses çalışmıyor
function unlockAudio() {
  if ("speechSynthesis" in window) {
    // Sessiz bir utterance çalıştır — ses motorunu uyandırır
    const silent = new SpeechSynthesisUtterance("");
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
    window.speechSynthesis.cancel();
  }
}

onMounted(async () => {
  // Bildirim izni iste
  console.log("[DEBUG] onMounted çalıştı");
  
  try {
    console.log("[DEBUG] izin fonksiyonu çağrılıyor");
    await requestNotificationPermission();
  } catch (err) {
    console.error("[DEBUG] izin hatası:", err);
  }
  // İlk tıklamada/dokunmada ses motorunu uyandır
  document.addEventListener("click", unlockAudio, { once: true });
  document.addEventListener("touchstart", unlockAudio, { once: true });
});
</script>

<template>
  <RouterView></RouterView>
  <AppMessage :messages="messageState.messages" />
</template>
