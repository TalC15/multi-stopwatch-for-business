<script setup>
import { RouterView } from "vue-router";
import AppMessage from "./components/ui/AppMessage.vue";
import { messageState } from "./composables/message.js";
import { onMounted } from "vue";
import { requestNotificationPermission } from "./utils/notifications";
 
// PWA'da speechSynthesis'i kullanıcı etkileşimiyle uyandır
// Bu olmadan PWA/production modda ses çalışmıyor
function unlockAudio() {
  if ('speechSynthesis' in window) {
    // Sessiz bir utterance çalıştır — ses motorunu uyandırır
    const silent = new SpeechSynthesisUtterance('');
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
    window.speechSynthesis.cancel();
  }
  // Bir kez tetiklendikten sonra listener'ı kaldır
  document.removeEventListener('click', unlockAudio);
  document.removeEventListener('touchstart', unlockAudio);
}
 
onMounted(() => {
  // Bildirim izni iste
  requestNotificationPermission();
  // İlk tıklamada/dokunmada ses motorunu uyandır
  document.addEventListener('click', unlockAudio, { once: true });
  document.addEventListener('touchstart', unlockAudio, { once: true });
});
</script>
 
<template>
  <RouterView></RouterView>
  <AppMessage :messages="messageState.messages" />
</template>