<template>
  <div class="login-scene relative isolate flex min-h-screen items-center justify-center bg-[var(--color-surface)] px-4 py-8 text-[var(--color-text-primary)] sm:py-12">
    <!-- Dekoratif sayaç arka planı: formun etkileşimlerini etkilemez. -->
    <div class="login-background pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div class="login-glow login-glow--indigo"></div>
      <div class="login-glow login-glow--violet"></div>

      <svg class="login-dial" viewBox="0 0 240 248" fill="none" stroke="currentColor" focusable="false">
        <rect x="108" y="6" width="24" height="10" rx="4" stroke-width="1.5" />
        <path d="M120 16v12m70 19 9-10" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="120" cy="124" r="96" stroke-width="1" />
        <circle cx="120" cy="124" r="84" stroke-width="5" stroke-dasharray="1 7.79646" />
        <circle cx="120" cy="124" r="70" stroke-width="0.7" opacity="0.45" />
        <path d="M120 36v9m88 79h-9m-79 88v-9m-88-79h9" stroke-width="2" stroke-linecap="round" />
        <path d="M120 124 156 100" stroke-width="2" stroke-linecap="round" opacity="0.65" />
        <g class="login-timer-sweep">
          <path d="M120 124V62" stroke-width="1.8" stroke-linecap="round" />
          <circle cx="120" cy="62" r="3" fill="currentColor" stroke="none" />
        </g>
        <circle cx="120" cy="124" r="4" fill="currentColor" stroke="none" />
      </svg>

      <div class="login-orbit"></div>
    </div>

    <div class="relative z-10 flex w-full max-w-sm flex-col gap-6 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-xl shadow-indigo-950/5 sm:p-8">
      <div class="pointer-events-none absolute top-0 right-8 left-8 h-px bg-linear-to-r from-transparent via-indigo-500/40 to-transparent" aria-hidden="true"></div>

      <!-- Logo / Başlık -->
      <div class="flex flex-col items-center text-center">
        <h1 class="flex items-center gap-2.5 text-2xl font-black tracking-tight text-[var(--color-text-primary)]">
          <span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-indigo-500/10">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 300 300"
              class="size-9 shrink-0"
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
        <p class="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">Hesabınıza giriş yapın</p>
      </div>

      <RouterLink to="/" class="inline-flex items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-center text-xs font-semibold text-indigo-600 transition hover:border-indigo-500/25 hover:bg-indigo-500/5 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-300">Giriş yapmadan kullan</RouterLink>
      <!-- Form -->
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <label for="login-username" class="text-xs font-bold text-[var(--color-text-secondary)]">Kullanıcı adı</label>
          <input
            id="login-username"
            v-model="username"
            type="text"
            placeholder="Kullanıcı adınız"
            maxlength="25"
            class="min-w-0 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="login-pin" class="text-xs font-bold text-[var(--color-text-secondary)]">PIN</label>
          <input
            id="login-pin"
            v-model="pin"
            type="password"
            placeholder="PIN'iniz"
            class="min-w-0 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
          />
        </div>

        <!-- Hata mesajı -->
        <p v-if="error" role="alert" class="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-center text-xs leading-relaxed text-rose-600 dark:text-rose-400">{{ error }}</p>

        <!-- Giriş butonu -->
        <button
          type="button"
          @click="handleLogin"
          :disabled="loading || !username || !pin"
          class="w-full rounded-2xl bg-indigo-600 px-4 py-3.5 text-sm font-extrabold text-white shadow-md shadow-indigo-600/15 transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40 disabled:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        >
          {{ loading ? 'Giriş yapılıyor...' : 'Giriş Yap' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-scene {
  min-height: 100dvh;
}

.login-background {
  background:
    radial-gradient(ellipse at 15% 15%, rgb(99 102 241 / 0.06), transparent 48%),
    radial-gradient(ellipse at 85% 85%, rgb(139 92 246 / 0.05), transparent 48%);
}

.login-glow {
  position: absolute;
  width: clamp(14rem, 38vw, 30rem);
  aspect-ratio: 1;
  border-radius: 50%;
  filter: blur(48px);
}

.login-glow--indigo {
  top: -15%;
  left: -8%;
  background: rgb(99 102 241 / 0.13);
}

.login-glow--violet {
  right: -10%;
  bottom: -16%;
  background: rgb(139 92 246 / 0.11);
}

.login-dial {
  position: absolute;
  top: 50%;
  left: calc(50% - 39rem);
  width: clamp(25rem, 65vw, 52rem);
  color: #6366f1;
  opacity: 0.13;
  transform: translateY(-50%) rotate(-12deg);
}

.login-timer-sweep {
  transform-box: view-box;
  transform-origin: center;
}

.login-orbit {
  position: absolute;
  right: -3%;
  bottom: 6%;
  width: clamp(10rem, 24vw, 18rem);
  aspect-ratio: 1;
  border: 1px solid rgb(99 102 241 / 0.1);
  border-radius: 50%;
}

.login-orbit::before {
  position: absolute;
  inset: 18%;
  border: 1px dashed rgb(99 102 241 / 0.1);
  border-radius: 50%;
  content: "";
}

.login-orbit::after {
  position: absolute;
  top: 50%;
  left: -3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(99 102 241 / 0.22);
  content: "";
}

@media (max-width: 639px) {
  .login-dial {
    left: 50%;
    width: 29rem;
    transform: translate(-57%, -50%) rotate(-12deg);
  }

  .login-orbit {
    display: none;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .login-glow--indigo {
    animation: login-glow-drift 18s ease-in-out infinite alternate;
  }

  .login-glow--violet {
    animation: login-glow-drift 22s ease-in-out infinite alternate-reverse;
  }

  .login-timer-sweep {
    animation: login-timer-turn 72s linear infinite;
  }

  .login-orbit {
    animation: login-timer-turn 48s linear infinite reverse;
  }
}

@keyframes login-glow-drift {
  from { transform: translate(0, 0) scale(1); }
  to { transform: translate(24px, 28px) scale(1.06); }
}

@keyframes login-timer-turn {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { login } from '../services/backendSync';
import { connectSocket } from "@/services/socket";
import { message } from "@/composables/message";

const router = useRouter();
const username = ref('');
const pin = ref('');
const error = ref('');
const loading = ref(false);

const handleLogin = message.withLoading("Giriş yapılıyor...", async () => {
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
});
</script>