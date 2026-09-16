<script setup>
import { logout as apiLogout, getUser } from "../../services/backendSync";
import { disconnectSocket } from "../../services/socket";

defineEmits(["open-menu"]);

const user = getUser();

function logout() {
  disconnectSocket();
  apiLogout();
}
</script>

<template>
  <nav
    class="h-14 bg-card border-b border-border px-4 flex items-center justify-between sticky top-0 z-30 transition-colors duration-300"
  >
    <!-- Sol: Kronometre İkonu -->
    <button
      @click="$emit('open-menu')"
      class="w-9 h-9 flex items-center justify-center text-primary-light active:scale-90 transition-transform"
      aria-label="Menü"
    >
      <svg
        class="w-8 h-8 text-indigo-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M10 3h4" />
        <path d="M19 6l1-1" />
        <circle cx="12" cy="13" r="7" />
        <line x1="12" y1="10" x2="12" y2="13" />
        <path />
      </svg>
    </button>

    <!-- Orta: Kullanıcı adı + Logo -->
    <div class="flex flex-col items-center">
      <h1 class="text-lg font-black tracking-tight text-primary-light">
        TimeKeep
      </h1>
      <span v-if="user" class="text-xs text-[var(--color-text-secondary)]">{{
        user.username
      }}</span>
    </div>

    <!-- Sağ: Logout -->
    <button
      @click="logout"
      class="w-9 h-9 flex items-center justify-center text-primary-light active:scale-90 transition-transform"
      aria-label="Çıkış"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
      >
        <!-- Kapı -->
        <path
          d="M10 3H6C5.45 3 5 3.45 5 4V20C5 20.55 5.45 21 6 21H10"
          stroke="#4F46E5"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <!-- Çıkış oku -->
        <path
          d="M10 12H20"
          stroke="#4F46E5"
          stroke-width="2"
          stroke-linecap="round"
        />
        <path
          d="M16 8L20 12L16 16"
          stroke="#4F46E5"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  </nav>
</template>
