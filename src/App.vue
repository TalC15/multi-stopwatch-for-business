<script setup>
import { RouterView } from "vue-router";
import { connectSocket, disconnectSocket } from './services/socket';
import { isLoggedIn } from './services/backendSync';
import AppMessage from "./components/ui/AppMessage.vue";
import { messageState } from "./composables/message.js";
import { onMounted } from "vue";
import { requestNotificationPermission } from "./utils/notifications";
// PWA'da speechSynthesis'i kullanıcı etkileşimiyle uyandır
// Bu olmadan PWA/production modda ses çalışmıyor
// App.vue — unlockAudio fonksiyonunu güncelle
function unlockAudio() {
  if ("speechSynthesis" in window) {
    const silent = new SpeechSynthesisUtterance(" ");
    silent.volume = 0;
    silent.rate = 2;
    window.speechSynthesis.speak(silent);
  }

  // iOS için ses context'i de uyandır
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const ctx = new AudioContext();
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      ctx.resume();
    }
  } catch (e) {
    console.log("Audio unlock hatası:", e);
  }
}

onMounted(async () => {
  try {
    await requestNotificationPermission();
  } catch (err) {
    console.error("[DEBUG] izin hatası:", err);
  }
  //ilk tıklamada/dokunmada ses motorunu uyandır
  document.addEventListener("click", unlockAudio, { once: true });
  document.addEventListener("touchstart", unlockAudio, { once: true });

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
