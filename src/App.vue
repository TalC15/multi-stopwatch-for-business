<script setup>
import { RouterView } from "vue-router";
import AppMessage from "./components/ui/AppMessage.vue";
import { messageState } from "./composables/message.js";
</script>
<template>
  <RouterView></RouterView>
  <AppMessage
  :messages="messageState.messages"
  />
</template>
