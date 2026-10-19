<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { loadAccountSecurity } from '../services/accountSecurity.js';
import * as auth from '../services/backendSync.js';
import { isAndroidAuthPlatform } from '../services/keepTimerAuth.js';
const supported=ref(false);
let revision=0;
async function refresh(){const turn=++revision;supported.value=false;const result=await loadAccountSecurity();if(turn===revision)supported.value=result.ok && result.supported;}
const events=[auth.AUTH_SESSION_CHANGED_EVENT,auth.AUTH_USER_CHANGED_EVENT].filter(Boolean);
onMounted(()=>{events.forEach(name=>globalThis.window?.addEventListener(name,refresh));void refresh();});
onBeforeUnmount(()=>{revision++;events.forEach(name=>globalThis.window?.removeEventListener(name,refresh));});
</script>
<template>
 <div v-if="supported" class="mt-4 border-t border-[var(--color-border)] pt-4">
  <RouterLink to="/account/security" class="inline-flex min-h-10 items-center rounded-xl px-3 py-2 text-sm font-semibold text-indigo-600 focus-visible:outline-2 dark:text-indigo-300">Parola güvenliği</RouterLink>
  <p v-if="isAndroidAuthPlatform()" class="mt-1 text-xs text-[var(--color-text-secondary)]">Parola ve oturum yönetimini güvenli web hesabınızdan tamamlayın.</p>
 </div>
</template>
