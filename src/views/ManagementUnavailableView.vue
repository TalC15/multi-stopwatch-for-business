<script setup>
import { ref } from 'vue';
import { logout, getUser } from '../services/backendSync.js';
const error = ref('');
async function signOut() {
  const result = await logout();
  if (!result.success) error.value = 'Çıkış doğrulanamadı. Tekrar deneyin.';
}
</script>
<template>
  <main class="mx-auto my-16 max-w-xl rounded-3xl border border-border bg-card p-8">
    <h1 class="text-2xl font-bold">Web yönetimi</h1>
    <p class="my-4">Vekil ve satış yönetimi yalnız web tarayıcısında kullanılabilir. Vekil için yeni parola girişi ve e-posta güvenlik doğrulaması henüz hazır değildir.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="getUser()" type="button" class="rounded-xl bg-indigo-700 px-5 py-3 text-white" @click="signOut">Çıkış yap</button>
    <RouterLink v-else to="/login" class="text-indigo-600 underline dark:text-indigo-300">Giriş ekranı</RouterLink>
  </main>
</template>
