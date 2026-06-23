<template>
  <div class="min-h-screen bg-[var(--color-surface)] flex items-center justify-center p-4">
    <div class="w-full max-w-sm bg-[var(--color-card)] rounded-3xl shadow-2xl p-8 flex flex-col gap-6">
      
      <!-- Logo / Başlık -->
      <div class="text-center">
        <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">KeepTime</h1>
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
  } else {
    error.value = result.error || 'Giriş başarısız';
  }

  loading.value = false;
}
</script>