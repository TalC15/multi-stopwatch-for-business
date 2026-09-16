```vue
<template>
  <div class="fixed top-5 left-1/2 -translate-x-1/2 z-9999">
    <TransitionGroup name="message" tag="div" class="flex flex-col gap-2">
      <div
        v-for="message in messages"
        :key="message.id"
        class="flex items-center gap-3 rounded-xl border text-white font-mono px-4 py-3 shadow-lg"
        :class="{
          'bg-[#432DD7] border-green-100': message.type === 'success',

          'bg-[#D14F5F] border-red-200': message.type === 'error',

          'bg-amber-500 border-amber-200': message.type === 'warning',
        }"
      >
        <!-- SUCCESS -->
        <svg
          v-if="message.type === 'success'"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class="w-5 h-5 text-green-400 shrink-0"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12l3 3 5-5" />
        </svg>

        <!-- ERROR -->
        <svg
          v-else-if="message.type === 'error'"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class="w-5 h-5 text-white shrink-0"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8 8l8 8" />
          <path d="M16 8l-8 8" />
        </svg>

        <!-- WARNING -->
        <svg
          v-else-if="message.type === 'warning'"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class="w-5 h-5 text-white shrink-0"
        >
          <path
            d="M10.3 3.7L2.5 17.2C1.7 18.6 2.7 20.4 4.3 20.4H19.7C21.3 20.4 22.3 18.6 21.5 17.2L13.7 3.7C12.9 2.3 11.1 2.3 10.3 3.7Z"
          />
          <path d="M12 9V13" />
          <circle cx="12" cy="16.5" r="0.7" fill="currentColor" stroke="none" />
        </svg>

        <span>
          {{ message.text }}
        </span>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
defineProps({
  messages: {
    type: Array,
    default: () => [],
  },
});
</script>

<style>
.message-enter-active {
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.message-leave-active {
  transition: opacity 0.35s ease;
}

.message-enter-from {
  opacity: 0;
  transform: translateY(-18px);
}

.message-enter-to {
  opacity: 1;
  transform: translateY(0);
}

.message-leave-from {
  opacity: 1;
}

.message-leave-to {
  opacity: 0;
}
</style>
