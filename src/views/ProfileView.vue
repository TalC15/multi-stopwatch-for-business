<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/composables/message";
import { disconnectSocket, connectSocket } from "@/services/socket";
import {
  apiFetch,
  getAccessToken,
} from "@/services/backendSync";
import { useStopwatchStore } from "../stores/stopwatchStore";

import { useTelegramConnection } from '../composables/useTelegramConnection.js';
import { accountExperience } from '../services/accountExperience.js';
import AccountStatusCard from '../components/AccountStatusCard.vue';
import { captureWorkspaceSession } from "../services/workspaceSession.js";

const store = useStopwatchStore();
const canTelegram = computed(() => accountExperience.canFeature('telegram'));
const individual = computed(() => accountExperience.currentData.value?.account.kind === 'individual');
const user = computed(() => store.user);
const router = useRouter();
const BASE_URL = "https://multi-stopwatch-backend.onrender.com";
const workspace = ref(null);
const loading = ref(false);
const joinLoading = ref(false);
const leaveLoading = ref(false);
const inviteCode = ref("");
const { chatId, telegramSaved, telegramBusy, telegramError, telegramNotice, telegramConfirmed, canManageTelegram, telegramSavedControl, saveTelegram, removeTelegram } = useTelegramConnection();
function authHeader() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getAccessToken()}`,
  };
}

let alive = true, workspaceRequest = 0;
onBeforeUnmount(() => { alive = false; workspaceRequest++; });
watch(() => accountExperience.state.scopeVersion, () => {
  workspaceRequest++; workspace.value = null; inviteCode.value = ''; loading.value = false;
  joinLoading.value = false; leaveLoading.value = false;
});
async function fetchWorkspace() {
  if (joinLoading.value || leaveLoading.value) return;
  const session = captureWorkspaceSession(), request = ++workspaceRequest;
  const current = () => alive && request === workspaceRequest && session.isCurrent();
  if (!await accountExperience.ensureFresh() || !current() || !accountExperience.canShared()) return;
  loading.value = true;
  try {
    const response = await apiFetch(`${BASE_URL}/workspace`, { headers: authHeader(), isRequestCurrent: current });
    if (!response?.ok) return;
    const data = await response.json();
    if (current()) workspace.value = data.workspace;
  } finally { if (current()) loading.value = false; }
}

async function changeWorkspace(action) {
  if (joinLoading.value || leaveLoading.value || action === 'join' && !inviteCode.value) return;
  const session = captureWorkspaceSession(), input = inviteCode.value;
  const busy = action === 'join' ? joinLoading : leaveLoading;
  const operation = ++workspaceRequest;
  const current = () => alive && operation === workspaceRequest && session.isCurrent();
  busy.value = true; loading.value = false;
  try {
    if (!await accountExperience.ensureFresh() || !current() || !accountExperience.canShared()) return;
    const response = await apiFetch(`${BASE_URL}/workspace/${action}`, {
      method: 'POST', headers: authHeader(), isRequestCurrent: current,
      ...(action === 'join' ? { body: JSON.stringify({ inviteCode: input }) } : {}),
    });
    if (!response) return;
    const data = await response.json();
    if (!current()) return;
    if (!response.ok) { message.warning(data.error || 'Çalışma grubu işlemi tamamlanamadı.'); return; }
    if (!session.saveWorkspace(action === 'join' ? data.workspace?.id : null)) return;
    workspace.value = action === 'join' ? data.workspace : null; inviteCode.value = '';
    message.success(action === 'join' ? 'Çalışma grubuna katıldınız.' : 'Çalışma grubundan ayrıldınız.');
    disconnectSocket(); connectSocket();
  } catch { if (current()) message.error('Çalışma grubu işlemi tamamlanamadı.'); }
  finally { if (alive && operation === workspaceRequest) busy.value = false; }
}
const joinWorkspace = () => changeWorkspace('join');
const leaveWorkspace = () => changeWorkspace('leave');
watch([() => accountExperience.state.scopeVersion, () => accountExperience.currentData.value?.shared], () => {
  if (accountExperience.canShared()) void fetchWorkspace().catch(() => {});
}, { immediate: true, flush: 'post' });

onMounted(async () => {
  await accountExperience.ensureFresh();
});
</script>

<template>
  <RouterLink to="/account/security" class="block rounded-xl border border-[var(--color-border)] p-3 text-center text-indigo-600 dark:text-indigo-300">Parola güvenliği</RouterLink>
  <div
    class="min-h-screen bg-[var(--color-surface)] text-[var(--color-text-primary)]"
  >
    <nav
      class="sticky top-0 z-30 grid h-16 w-full grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 backdrop-blur-xl sm:px-6"
    >
      <button
        type="button"
        aria-label="Ana sayfaya dön"
        @click="router.push('/')"
        class="grid size-10 shrink-0 justify-self-start place-items-center rounded-2xl border border-[var(--color-border)] text-[var(--color-text-primary)] transition hover:bg-[var(--color-surface)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      >
        <svg
          class="size-5"
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>
      <div class="flex min-w-0 flex-col items-center">
        <h1 class="text-lg font-extrabold tracking-tight sm:text-base">
          Profilim
        </h1>
        <span
          v-if="user"
          class="max-w-full truncate text-[11px] text-[var(--color-text-secondary)]"
          >{{ user?.username }}</span
        >
      </div>
      <div class="size-10" aria-hidden="true"></div>
    </nav>

    <main class="mx-auto flex max-w-md flex-col gap-5 px-4 pt-6 pb-12 sm:px-6">
      <AccountStatusCard details :experience="accountExperience" :count="0" :ready="store.ready" @retry="accountExperience.refresh()" />
      <!--Profil Bilgileri-->
      <div
        class="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6"
      >
        <h2 class="mb-5 text-base font-black tracking-tight">
          Profil bilgilerim
        </h2>

        <div class="flex items-center gap-4">
          <!-- Yetki rengi ve baş harf: ekip paneliyle aynı -->
          <div
            class="grid size-16 shrink-0 place-items-center rounded-2xl text-2xl font-black"
            :class="
              user?.role === 'manager'
                ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                : user?.role === 'superadmin'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
                  : user?.role === 'worker'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300'
                    : ''
            "
            aria-hidden="true"
          >
            {{ user?.username?.charAt(0)?.toLocaleUpperCase("tr-TR") || "?" }}
          </div>

          <!-- Kullanıcı bilgileri -->
          <div class="flex min-w-0 flex-1 flex-col">
            <span
              class="truncate text-lg font-extrabold tracking-tight text-[var(--color-text-primary)]"
            >
              {{ user?.username || "Kullanıcı" }}
            </span>

            <span
              :class="[
                store.roleStyles[user?.role]?.text,
                'mt-0.5 text-[11px] font-semibold capitalize',
              ]"
            >
              {{ individual ? "Bireysel Kullanıcı" : user?.role || "Rol belirtilmemiş" }}
            </span>
          </div>
        </div>

        <div
          class="mt-5 flex flex-col gap-3 border-t border-[var(--color-border)] pt-4"
        >
          <div class="flex items-center justify-between">
            <span
              class="text-xs leading-relaxed text-[var(--color-text-secondary)]"
            >
              Durum
            </span>

            <span
              class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
            >
              <span class="size-1.5 rounded-full bg-emerald-500"></span>
              Aktif
            </span>
          </div>
        </div>
      </div>
      <!-- Workspace Durumu -->
      <div v-if="accountExperience.currentData.value?.shared"
        class="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6 flex flex-col gap-4"
      >
        <h2 class="text-base font-black tracking-tight">Çalışma grubum</h2>

        <div
          v-if="loading"
          class="rounded-2xl bg-[var(--color-surface)] py-5 text-center text-sm text-[var(--color-text-secondary)]"
        >
          Yükleniyor...
        </div>

        <!-- Workspace var -->
        <div v-else-if="workspace" class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <div class="flex min-w-0 flex-col gap-0.5">
              <span
                class="truncate text-sm font-extrabold text-[var(--color-text-primary)]"
                >{{ workspace.name }}</span
              >
              <span
                class="text-xs font-medium text-emerald-600 dark:text-emerald-400"
                >Aktif</span
              >
            </div>
          </div>
          <button
            @click="leaveWorkspace"
            :disabled="leaveLoading || !accountExperience.canShared()"
            class="w-full rounded-2xl border border-rose-300 px-4 py-3 text-sm font-bold text-rose-600 transition hover:bg-rose-500/5 active:scale-[0.99] disabled:opacity-40 dark:border-rose-800 dark:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
          >
            {{ leaveLoading ? "Ayrılıyor..." : "Gruptan ayrıl" }}
          </button>
        </div>

        <!-- Workspace yok -->
        <div v-else class="flex flex-col gap-3">
          <p class="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            Henüz bir çalışma grubuna dahil değilsiniz. Davet kodu ile
            katılabilirsiniz.
          </p>
          <div class="flex gap-2">
            <input
              v-model="inviteCode"
              type="text"
              placeholder="Davet kodu"
              class="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm text-[var(--color-text-primary)] uppercase outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            />
            <button
              @click="joinWorkspace"
              :disabled="!inviteCode || joinLoading || !accountExperience.canShared()"
              class="shrink-0 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 active:scale-95 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              {{ joinLoading ? "..." : "Katıl" }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="canManageTelegram" class="mb-3 text-sm text-[var(--color-text-secondary)]">
        <p v-if="telegramBusy && telegramSaved === null">Telegram bağlantısı yükleniyor…</p>
        <p v-if="telegramError" role="status">{{ telegramError }}</p>
        <p v-if="telegramNotice" role="status">{{ telegramNotice }}</p>
        <button type="button" :disabled="telegramBusy" @click="telegramSavedControl" class="min-h-11 rounded-xl border border-[var(--color-border)] px-3 focus-visible:outline-2 focus-visible:outline-indigo-500">Durumu yenile</button>
      </div>
      <!-- Telegram bildirimi -->
      <div v-if="canManageTelegram"
        class="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6 flex flex-col gap-4"
      >
        <h2 class="text-base font-black tracking-tight">Telegram bildirimi</h2>
        <div :aria-busy="telegramBusy">
          <div v-if="telegramSaved !== true" class="flex flex-col gap-3">
            <p
              class="text-xs leading-relaxed text-[var(--color-text-secondary)]"
            >
              @KeepTimeApp_bot'a <strong>/start</strong> yaz, sonra chat ID'ni
              gir.
            </p>
            <input
              v-model="chatId"
              type="number"
              placeholder="Chat ID (örn: 1234567890)"
              class="no-spinner min-w-0 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            />
            <button
              @click="saveTelegram"
              :disabled="!chatId || telegramBusy || !canTelegram || telegramSaved !== false"
              class="w-full rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              {{ telegramBusy ? "Kaydediliyor..." : "Kaydet" }}
            </button>
          </div>

          <div v-else-if="telegramSaved === true" class="flex flex-wrap items-center justify-between gap-3">
            <span
              class="text-sm font-semibold text-emerald-600 dark:text-emerald-400"
              >{{ telegramConfirmed ? '✓ Telegram bağlı' : 'Son bilinen durum: Telegram bağlı' }}</span
            >
            <button
              @click="removeTelegram"
              :disabled="telegramBusy"
              class="min-h-11 shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] underline underline-offset-4 transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              Bağlantıyı kes
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
