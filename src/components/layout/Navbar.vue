<script setup>
import { logout as apiLogout } from "../../services/backendSync";
import { message } from "@/composables/message";

defineEmits(["open-menu"]);

import { computed } from "vue";
import { useStopwatchStore } from "../../stores/stopwatchStore.js";
const store = useStopwatchStore();
const user = computed(() => store.user);

const logout = message.withLoading("Çıkış yapılıyor...", async () => {
  const result = await apiLogout();
  if (!result.success) message.error(result.error);
});
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
        aria-hidden="true"
      >
        <!-- Kronometre: üst buton, yan buton, kadran -->
        <path d="M10 2.5h4" />
        <path d="M19 6.2l1-1" />
        <circle cx="12" cy="13.5" r="8" />

        <!-- Kadranın içinde iki ayar çubuğu -->
        <path
          d="M8 11.5h1.4M12.6 11.5H16M8 15.5h4.4M15.6 15.5H16"
          stroke-width="1.4"
        />
        <circle cx="11" cy="11.5" r="1.1" stroke-width="1.3" />
        <circle cx="14" cy="15.5" r="1.1" stroke-width="1.3" />
      </svg>
    </button>

    <!-- Orta: Kullanıcı adı + Logo -->
    <div class="flex flex-col items-center">
      <h1
        class="flex items-center gap-1 text-lg font-black tracking-tight text-primary-light"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 300 300"
          class="w-[30px] h-[30px] shrink-0"
          aria-label="KeepTimer logosu"
        >
          <title>KeepTimer</title>

          <defs>
            <filter id="glowRing" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation="11"
                result="blur"
              />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <filter id="glowCheck" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation="5"
                result="blur"
              />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <!-- Arka plan kaldırıldı -->

          <circle cx="150" cy="150" r="98" fill="#2A2A7A" opacity="0.18" />

          <g
            filter="url(#glowRing)"
            fill="none"
            stroke="#6668E3"
            stroke-linecap="round"
          >
            <path stroke-width="14" d="M 214 68 A 104 104 0 1 0 242.7 102.8" />

            <g stroke-width="10">
              <line x1="150" y1="61" x2="150" y2="78" />
              <line x1="239" y1="150" x2="222" y2="150" />
              <line x1="150" y1="239" x2="150" y2="222" />
              <line x1="61" y1="150" x2="78" y2="150" />
            </g>
          </g>

          <path
            filter="url(#glowCheck)"
            d="M 123.5 131.5 L 147.5 159.5 L 247.5 63.5"
            fill="none"
            stroke="#FFFFFF"
            stroke-width="18"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>

        KeepTimer
      </h1>

      <span v-if="user" class="text-xs text-[var(--color-text-secondary)]">{{
        user.username
      }}</span>
    </div>

    <RouterLink v-if="!user" to="/login" class="text-sm text-indigo-500"
      >Giriş</RouterLink
    >
    <!-- Sağ: Logout -->
    <button
      v-if="user"
      type="button"
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
        stroke="#4F46E5"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <!-- Yumuşak dolgulu kadran -->
        <circle
          cx="11"
          cy="13"
          r="7.5"
          fill="#4F46E5"
          fill-opacity="0"
          stroke="none"
        />

        <!-- Sağda açık bırakılmış kadran halkası -->
        <path d="M16.02 7.43A7.5 7.5 0 1 0 16.02 18.57" />

        <!-- Üst buton -->
        <path d="M9 2.5h4M11 2.5v3" />

        <!-- Akrep: dışarı çıkan ok -->
        <path d="M11 13h10M17.8 9.8L21 13l-3.2 3.2" />

        <!-- Akrebin merkez noktası -->
        <circle cx="11" cy="13" r="1" fill="#4F46E5" stroke="none" />
      </svg>
    </button>
  </nav>
</template>
