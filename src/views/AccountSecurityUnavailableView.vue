<script setup>
import { isAndroidAuthPlatform } from '../services/keepTimerAuth.js';
</script>
<template>
 <main class="min-h-dvh bg-[var(--color-surface)] px-4 py-10 text-[var(--color-text-primary)]">
  <section class="mx-auto max-w-md rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-6">
   <h1 class="text-xl font-bold">Hesap güvenliği</h1>
   <p class="mt-4">{{isAndroidAuthPlatform()?'Parola ve oturum yönetimini KeepTimer web uygulamasında, kendi hesabınızla giriş yaparak tamamlayın.':'Parola güvenliği bu oturumda doğrulanamadı. Şirket PIN hesapları mevcut PIN girişini kullanır; parola hesabınız varsa bağlantınızı kontrol edip yeniden deneyin.'}}</p>
   <RouterLink to="/" class="mt-5 inline-flex min-h-10 items-center text-indigo-600 dark:text-indigo-300">Ana sayfa</RouterLink>
   <RouterLink v-if="!isAndroidAuthPlatform()" to="/account/security" class="mt-3 flex min-h-10 items-center text-indigo-600 dark:text-indigo-300">Erişimi yeniden kontrol et</RouterLink>
  </section>
 </main>
</template>
