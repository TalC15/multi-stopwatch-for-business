<script setup>
import { logout as apiLogout, getUser } from "../../services/backendSync";

defineEmits(["open-menu"]);

const user = getUser();

async function logout() {
  await apiLogout();
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

    <!-- Sağ: Logout -->
    <button
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
