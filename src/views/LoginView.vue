<template>
  <div class="min-h-screen bg-[var(--color-surface)] flex items-center justify-center p-4">
    <div class="w-full max-w-sm bg-[var(--color-card)] rounded-3xl shadow-2xl p-8 flex flex-col gap-6">
      
      <!-- Logo / Başlık -->
      <div class="flex flex-col text-center items-center">
        <h1 class="flex items-center gap-1 tracking-tight text-2xl font-bold text-[var(--color-text-primary)]">
           <span>
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
        </span>
          KeepTimer
        </h1>
        <p class="text-sm text-[var(--color-text-secondary)] mt-1">Hesabınıza giriş yapın</p>
      </div>

      <!-- Form -->
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-[var(--color-text-secondary)]">Kullanıcı Adı</label>
          <input
            v-model="username"
            type="text"
            placeholder="Kullanıcı adınız"
            maxlength="25"
            class="px-4 py-3 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-primary)] transition"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-[var(--color-text-secondary)]">PIN</label>
          <input
            v-model="pin"
            type="password"
            placeholder="PIN'iniz"
            class="px-4 py-3 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-primary)] transition"
          />
        </div>

        <!-- Hata mesajı -->
        <p v-if="error" class="text-sm text-red-500 text-center">{{ error }}</p>

        <!-- Giriş butonu -->
        <button
          @click="handleLogin"
          :disabled="loading || !username || !pin"
          class="w-full py-3 rounded-2xl bg-indigo-700 text-white font-semibold transition active:scale-95 disabled:opacity-40"
        >
          {{ loading ? 'Giriş yapılıyor...' : 'Giriş Yap' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { login } from '../services/backendSync';
import { connectSocket } from "@/services/socket";

const router = useRouter();
const username = ref('');
const pin = ref('');
const error = ref('');
const loading = ref(false);

async function handleLogin() {
  error.value = '';
  loading.value = true;

  const result = await login(username.value, pin.value);

  if (result.success) {
    router.push('/');
    connectSocket();
  } else {
    error.value = result.error || 'Giriş başarısız';
  }

  loading.value = false;
}
</script>