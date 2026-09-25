
<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/composables/message";
import { disconnectSocket, connectSocket } from "@/services/socket";
import {
  apiFetch,
  getAccessToken,
  getUser,
  saveUser,
} from "@/services/backendSync";

const router = useRouter();
const BASE_URL = "https://multi-stopwatch-backend.onrender.com";

const users = ref([]);
const workspace = ref(null);

const loading = ref(false);
const usersLoadError = ref(false);
const createLoading = ref(false);
const workspaceLoading = ref(false);
const workspaceLoadingDiv = ref(false);
const workspaceLoadError = ref(false);
const leaveLoading = ref(false);
const refreshLoading = ref(false);
const sharedModeLoading = ref(false);

const newUsername = ref("");
const newPin = ref("");
const newWorkspaceName = ref("");
const inviteCode = ref("");

const sameWorkspaceUsers = computed(() =>
  users.value.filter(
    (user) =>
      workspace.value?.id &&
      user?.workspace_id === workspace.value.id &&
      !user.disabled_at,
  ),
);

const activeWorkerCount = computed(
  () =>
    sameWorkspaceUsers.value.filter(
      (user) => user.role === "worker",
    ).length,
);

const canLeaveWorkspace = computed(
  () => getUser()?.role === "superadmin",
);

const pendingDeactivation = ref(null);
const deactivationLoading = ref(false);
const uncertainUserIds = ref(new Set());
const cancelDeactivationButton = ref(null);

function authHeader() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getAccessToken()}`,
  };
}

async function responseData(response) {
  return response?.json().catch(() => ({})) ?? {};
}

function updateWorkspaceConnection(workspaceId) {
  const user = getUser();

  if (user) {
    user.workspace_id = workspaceId ?? null;
    saveUser(user);
  }

  disconnectSocket();
  connectSocket();
}

async function fetchWorkspace() {
  workspaceLoadingDiv.value = true;
  workspaceLoadError.value = false;

  try {
    const response = await apiFetch(`${BASE_URL}/workspace`, {
      headers: authHeader(),
    });

    if (!response) {
      workspaceLoadError.value = true;
      return;
    }

    const data = await responseData(response);

    if (!response.ok) {
      workspaceLoadError.value = true;
      message.error(
        data.error || "Çalışma grubu alınamadı",
      );
      return;
    }

    workspace.value = data.workspace ?? null;
  } catch {
    workspaceLoadError.value = true;
    message.error(
      "Çalışma grubu yüklenemedi. Bağlantını kontrol et.",
    );
  } finally {
    workspaceLoadingDiv.value = false;
  }
}

async function fetchUsers() {
  loading.value = true;
  usersLoadError.value = false;

  try {
    const response = await apiFetch(`${BASE_URL}/users`, {
      headers: authHeader(),
    });

    if (!response) {
      usersLoadError.value = true;
      return false;
    }

    const data = await responseData(response);

    if (!response.ok || !Array.isArray(data.users)) {
      usersLoadError.value = true;
      message.error(data.error || "Üyeler alınamadı");
      return false;
    }

    users.value = data.users;
    return true;
  } catch {
    usersLoadError.value = true;
    message.error(
      "Üyeler yüklenemedi. Bağlantını kontrol et.",
    );
    return false;
  } finally {
    loading.value = false;
  }
}

async function reloadManagerData() {
  await fetchWorkspace();

  if (workspace.value && !workspaceLoadError.value) {
    await fetchUsers();
  }
}

async function createWorkspace() {
  if (
    !newWorkspaceName.value.trim() ||
    workspaceLoading.value
  ) {
    return;
  }

  workspaceLoading.value = true;

  try {
    const response = await apiFetch(
      `${BASE_URL}/workspace/create`,
      {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({
          name: newWorkspaceName.value.trim(),
        }),
      },
    );

    if (!response) return;

    const data = await responseData(response);

    if (!response.ok) {
      message.warning(
        data.error || "Çalışma grubu oluşturulamadı",
      );
      return;
    }

    workspace.value = data.workspace;
    newWorkspaceName.value = "";
    updateWorkspaceConnection(data.workspace.id);

    message.success("Çalışma grubu oluşturuldu");
    await fetchUsers();
  } catch {
    message.error(
      "Çalışma grubu oluşturulamadı. Bağlantını kontrol et.",
    );
  } finally {
    workspaceLoading.value = false;
  }
}

async function joinWorkspace() {
  if (
    !inviteCode.value.trim() ||
    workspaceLoading.value
  ) {
    return;
  }

  workspaceLoading.value = true;

  try {
    const response = await apiFetch(
      `${BASE_URL}/workspace/join`,
      {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({
          inviteCode: inviteCode.value.trim(),
        }),
      },
    );

    if (!response) return;

    const data = await responseData(response);

    if (!response.ok) {
      message.warning(
        data.error || "Geçersiz davet kodu",
      );
      return;
    }

    workspace.value = data.workspace;
    inviteCode.value = "";

    updateWorkspaceConnection(data.workspace.id);

    message.success(
      `${data.workspace.name} çalışma grubuna katıldın`,
    );

    await fetchUsers();
  } catch {
    message.error(
      "Çalışma grubuna katılınamadı. Bağlantını kontrol et.",
    );
  } finally {
    workspaceLoading.value = false;
  }
}

async function leaveWorkspace() {
  if (
    !canLeaveWorkspace.value ||
    leaveLoading.value
  ) {
    return;
  }

  leaveLoading.value = true;

  try {
    const response = await apiFetch(
      `${BASE_URL}/workspace/leave`,
      {
        method: "POST",
        headers: authHeader(),
      },
    );

    if (!response) return;

    const data = await responseData(response);

    if (!response.ok) {
      message.error(
        data.error || "Ayrılma başarısız",
      );
      return;
    }

    workspace.value = null;
    users.value = [];

    updateWorkspaceConnection(null);
    message.success("Çalışma grubundan ayrıldın");
  } catch {
    message.error(
      "Ayrılma tamamlanamadı. Bağlantını kontrol et.",
    );
  } finally {
    leaveLoading.value = false;
  }
}

async function refreshInviteCode() {
  if (refreshLoading.value) return;

  refreshLoading.value = true;

  try {
    const response = await apiFetch(
      `${BASE_URL}/workspace/refresh-invite`,
      {
        method: "POST",
        headers: authHeader(),
      },
    );

    if (!response) return;

    const data = await responseData(response);

    if (!response.ok) {
      message.warning(
        data.error || "Kod yenilenemedi",
      );
      return;
    }

    if (workspace.value) {
      workspace.value.invite_code = data.invite_code;
    }

    message.success("Davet kodu yenilendi");
  } catch {
    message.error(
      "Davet kodu yenilenemedi. Bağlantını kontrol et.",
    );
  } finally {
    refreshLoading.value = false;
  }
}

async function createUser() {
  const username = newUsername.value.trim();

  if (
    !workspace.value ||
    !username ||
    !newPin.value ||
    createLoading.value
  ) {
    return;
  }

  if (
    username.length > 25 ||
    newPin.value.length > 25
  ) {
    message.error(
      "Kullanıcı adı ve PIN en fazla 25 karakter olabilir",
    );
    return;
  }

  createLoading.value = true;

  try {
    const response = await apiFetch(
      `${BASE_URL}/users/create`,
      {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({
          username,
          pin: newPin.value,
          role: "worker",
          workspace_id: workspace.value.id,
        }),
      },
    );

    if (!response) return;

    const data = await responseData(response);

    if (!response.ok) {
      message.error(
        data.error || "Çalışan oluşturulamadı",
      );
      return;
    }

    newUsername.value = "";
    newPin.value = "";

    message.success(`${username} oluşturuldu`);
    await fetchUsers();
  } catch {
    message.error(
      "Çalışan oluşturulamadı. Bağlantını kontrol et.",
    );
  } finally {
    createLoading.value = false;
  }
}

function requestDeactivation(user) {
  if (
    deactivationLoading.value ||
    pendingDeactivation.value ||
    uncertainUserIds.value.has(user?.id) ||
    user?.role !== "worker" ||
    !workspace.value?.id ||
    user.workspace_id !== workspace.value.id ||
    user.id === getUser()?.id
  ) {
    return;
  }

  pendingDeactivation.value = { ...user };

  nextTick(() => {
    cancelDeactivationButton.value?.focus();
  });
}

function cancelDeactivation() {
  if (!deactivationLoading.value) {
    pendingDeactivation.value = null;
  }
}

async function confirmDeactivation() {
  const target = pendingDeactivation.value;

  if (
    !target ||
    deactivationLoading.value
  ) {
    return;
  }

  const validTarget =
    target.role === "worker" &&
    target.id !== getUser()?.id &&
    target.workspace_id === workspace.value?.id &&
    sameWorkspaceUsers.value.some(
      (user) =>
        user.id === target.id &&
        user.role === "worker",
    );

  if (!validTarget) {
    pendingDeactivation.value = null;

    message.warning(
      "Üye listesi değişmiş. Önce listeyi yenile.",
    );

    await fetchUsers();
    return;
  }

  deactivationLoading.value = true;

  try {
    // Phase 2B:
    // DELETE isteği fiziksel silme yapmaz.
    // Backend hesabı kapatır ve kişisel kayıtları arşivler.

    const response = await apiFetch(
      `${BASE_URL}/users/${encodeURIComponent(target.id)}`,
      {
        method: "DELETE",
        headers: authHeader(),
      },
    );

    if (!response) {
      uncertainUserIds.value = new Set([
        ...uncertainUserIds.value,
        target.id,
      ]);

      pendingDeactivation.value = null;

      message.warning(
        "Oturum değişti veya işlem sonucu alınamadı. " +
        "Tekrar denemeden önce kontrol et.",
      );

      return;
    }

    const data = await responseData(response);

    if (
      response.ok &&
      data.success === true
    ) {
      pendingDeactivation.value = null;

      message.success(
        data.alreadyDisabled
          ? `${target.username} zaten devre dışı`
          : `${target.username} devre dışı bırakıldı. ` +
            "Kişisel kayıtları şirkette saklandı.",
      );

      if (!(await fetchUsers())) {
        message.warning(
          "İşlem onaylandı ancak liste yenilenemedi. " +
          "Sayfayı yeniden aç.",
        );
      }

      return;
    }

    if (response.status === 503) {
      // RPC gerçekleşmiş olsa bile ağ geçidi hata verebilir.
      // Bu durumda sonucu kesin başarısız olarak göstermeyiz.

      uncertainUserIds.value = new Set([
        ...uncertainUserIds.value,
        target.id,
      ]);

      pendingDeactivation.value = null;

      message.warning(
        "İşlemin sonucu belirsiz. Üye listesini kontrol et; " +
        "hemen tekrar deneme.",
      );

      await fetchUsers();
      return;
    }

    message.error(
      data.error || "Hesap devre dışı bırakılamadı",
    );
  } catch {
    uncertainUserIds.value = new Set([
      ...uncertainUserIds.value,
      target.id,
    ]);

    pendingDeactivation.value = null;

    message.warning(
      "Bağlantı kesildi: işlem sonucu belirsiz. " +
      "Tekrar denemeden önce listeyi kontrol et.",
    );

    await fetchUsers();
  } finally {
    deactivationLoading.value = false;
  }
}

async function toggleSharedMode() {
  if (
    sharedModeLoading.value ||
    !workspace.value
  ) {
    return;
  }

  sharedModeLoading.value = true;

  try {
    const response = await apiFetch(
      `${BASE_URL}/workspace/toggle-shared`,
      {
        method: "POST",
        headers: authHeader(),
      },
    );

    if (!response) return;

    const data = await responseData(response);

    if (!response.ok) {
      message.warning(
        data.error || "İşlem başarısız",
      );
      return;
    }

    workspace.value.shared_mode_enabled =
      data.shared_mode_enabled;

    message.success(
      data.shared_mode_enabled
        ? "Ortak ekran açıldı"
        : "Ortak ekran kapatıldı",
    );
  } catch {
    message.error(
      "Ortak ekran güncellenemedi. Bağlantını kontrol et.",
    );
  } finally {
    sharedModeLoading.value = false;
  }
}

onMounted(async () => {
  await fetchWorkspace();

  if (workspace.value) {
    await fetchUsers();
  }
});
</script>

<template>
  <div
    class="min-h-screen bg-[var(--color-surface)] pb-8 text-[var(--color-text-primary)]"
  >
    <!-- Üst navigasyon -->
    <nav
      class="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-card)] backdrop-blur-xl"
    >
      <div
        class="mx-auto flex h-16 max-w-2xl items-center justify-between px-4 sm:px-6"
      >
        <button
          type="button"
          aria-label="Geri dön"
          @click="router.back()"
          class="grid size-10 place-items-center rounded-2xl border border-[var(--color-border)] text-[var(--color-text-primary)] transition hover:bg-[var(--color-surface)] active:scale-95 focus-visible:outline-2 focus-visible:outline-indigo-500"
        >
          <svg
            viewBox="0 0 24 24"
            class="size-5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>

        <div class="text-center">
          <p
            class="text-[10px] font-black tracking-[0.26em] text-indigo-500 uppercase"
          >
            KeepTimer
          </p>

          <h1
            class="text-sm font-extrabold tracking-tight sm:text-base"
          >
            Yönetici Paneli
          </h1>
        </div>

        <div
          class="grid size-10 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            class="size-5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <path d="M8 11v6m4-10v10m4-7v7" />
          </svg>
        </div>
      </div>
    </nav>

    <main
      class="mx-auto flex max-w-2xl flex-col gap-5 px-4 pt-6 pb-16 sm:px-6"
    >
      <!-- Hero -->
      <header
        class="relative isolate overflow-hidden rounded-[28px] bg-gradient-to-br from-indigo-800 via-indigo-700 to-violet-700 p-6 text-white shadow-xl shadow-indigo-950/15 sm:p-7"
      >
        <div
          class="pointer-events-none absolute -top-20 -right-12 size-52 rounded-full border border-white/15 bg-white/10 blur-[2px]"
          aria-hidden="true"
        ></div>

        <div
          class="pointer-events-none absolute -right-12 -bottom-28 size-64 rounded-full bg-fuchsia-400/20 blur-3xl"
          aria-hidden="true"
        ></div>

        <div class="relative">
          <span
            class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-bold tracking-widest uppercase backdrop-blur-sm"
          >
            <span
              class="size-1.5 rounded-full bg-emerald-300"
            ></span>
            Ekip yönetimi
          </span>

          <div
            v-if="workspace"
            class="mt-6 grid grid-cols-2 gap-3"
          >
            <div
              class="rounded-2xl border border-white/15 bg-white/10 p-3.5 backdrop-blur-sm"
            >
              <div
                class="text-2xl font-black tabular-nums"
              >
                {{ sameWorkspaceUsers.length }}
              </div>

              <div class="mt-1 text-xs text-indigo-100">
                Aktif üye
              </div>
            </div>

            <div
              class="rounded-2xl border border-white/15 bg-white/10 p-3.5 backdrop-blur-sm"
            >
              <div
                class="text-2xl font-black tabular-nums"
              >
                {{ activeWorkerCount }}
              </div>

              <div class="mt-1 text-xs text-indigo-100">
                Aktif çalışan
              </div>
            </div>
          </div>
        </div>
      </header>

      <!-- Çalışma grubu -->
      <section
        class="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6"
        aria-labelledby="workspace-heading"
      >
        <div class="mb-5 flex items-center gap-3">
          <div
            class="grid size-11 shrink-0 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect
                x="3"
                y="7"
                width="18"
                height="14"
                rx="2"
              />
              <path
                d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"
              />
            </svg>
          </div>

          <div>
            <h2
              id="workspace-heading"
              class="text-base font-black tracking-tight"
            >
              Çalışma grubum
            </h2>

            <p
              class="text-xs text-[var(--color-text-secondary)]"
            >
              Ekip ayarları ve davet bilgileri
            </p>
          </div>
        </div>

        <!-- Yüklenme -->
        <div
          v-if="workspaceLoadingDiv"
          role="status"
          class="rounded-2xl bg-[var(--color-surface)] p-5 text-center text-sm text-[var(--color-text-secondary)]"
        >
          Yükleniyor...
        </div>

        <!-- Hata -->
        <div
          v-else-if="workspaceLoadError"
          role="alert"
          class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center"
        >
          <p
            class="text-sm font-semibold text-amber-800 dark:text-amber-200"
          >
            Çalışma grubu bilgileri alınamadı.
          </p>

          <button
            type="button"
            @click="reloadManagerData"
            class="mt-3 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-extrabold text-white transition hover:bg-indigo-700"
          >
            Tekrar dene
          </button>
        </div>

        <!-- Mevcut çalışma grubu -->
        <div
          v-else-if="workspace"
          class="space-y-4"
        >
          <!-- Grup adı -->
          <div
            class="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          >
            <div class="min-w-0">
              <p
                class="text-[10px] font-bold tracking-widest text-[var(--color-text-secondary)] uppercase"
              >
                Grup adı
              </p>

              <p
                class="mt-1 truncate text-base font-extrabold"
              >
                {{ workspace.name }}
              </p>
            </div>

            <span
              class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400"
            >
              <span
                class="size-1.5 rounded-full bg-emerald-500"
              ></span>
              Aktif
            </span>
          </div>

          <!-- Davet kodu -->
          <div
            class="rounded-2xl border border-[var(--color-border)] p-4"
          >
            <div
              class="mb-3 flex items-center justify-between gap-3"
            >
              <div>
                <h3 class="text-sm font-bold">
                  Davet kodu
                </h3>

                <p
                  class="mt-0.5 text-xs text-[var(--color-text-secondary)]"
                >
                  Yeni üyelerinle paylaş
                </p>
              </div>

              <button
                type="button"
                @click="refreshInviteCode"
                :disabled="refreshLoading"
                class="rounded-xl bg-indigo-500/10 px-3 py-2 text-xs font-bold text-indigo-600 transition hover:bg-indigo-500/15 active:scale-95 disabled:cursor-wait disabled:opacity-50 dark:text-indigo-300 focus-visible:outline-2 focus-visible:outline-indigo-500"
              >
                {{
                  refreshLoading
                    ? "Yenileniyor..."
                    : "Kodu yenile"
                }}
              </button>
            </div>

            <div
              class="rounded-xl bg-[var(--color-surface)] px-4 py-3 font-mono text-lg font-black tracking-[0.24em] text-indigo-600 dark:text-indigo-300"
            >
              {{ workspace.invite_code }}
            </div>
          </div>

          <!-- Ortak ekran -->
          <div
            class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] p-4"
          >
            <div class="min-w-0">
              <h3 class="text-sm font-bold">
                Ortak ekran
              </h3>

              <p
                class="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]"
              >
                Ekip arkadaşları paylaşılan kronometreleri
                birlikte görebilir.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-label="Ortak ekran"
              :aria-checked="Boolean(workspace.shared_mode_enabled)"
              :disabled="sharedModeLoading"
              @click="toggleSharedMode"
              :class="
                workspace.shared_mode_enabled
                  ? 'bg-indigo-600'
                  : 'bg-slate-300 dark:bg-slate-600'
              "
              class="relative h-8 w-14 shrink-0 rounded-full p-1 transition-colors duration-200 disabled:cursor-wait disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              <span
                :class="
                  workspace.shared_mode_enabled
                    ? 'translate-x-6'
                    : 'translate-x-0'
                "
                class="block size-6 rounded-full bg-white shadow-sm transition-transform duration-200"
              ></span>
            </button>
          </div>

          <!-- Ayrılma -->
          <button
            v-if="canLeaveWorkspace"
            type="button"
            @click="leaveWorkspace"
            :disabled="leaveLoading"
            class="w-full rounded-2xl border border-rose-300 px-4 py-3 text-sm font-bold text-rose-600 transition hover:bg-rose-500/5 active:scale-[0.99] disabled:opacity-50 dark:border-rose-800 dark:text-rose-400"
          >
            {{
              leaveLoading
                ? "Ayrılıyor..."
                : "Çalışma grubundan ayrıl"
            }}
          </button>

          <p
            v-else
            class="flex items-center gap-2 px-1 text-xs text-[var(--color-text-secondary)]"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-4 shrink-0"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect
                x="5"
                y="10"
                width="14"
                height="11"
                rx="2"
              />
              <path
                d="M8 10V7a4 4 0 0 1 8 0v3"
              />
            </svg>

            Şirket hesapları güvenlik gereği çalışma
            grubundan ayrılamaz.
          </p>
        </div>

        <!-- Henüz çalışma grubu yok -->
        <div
          v-else
          class="space-y-5"
        >
          <div class="space-y-2">
            <label
              for="workspace-name"
              class="block text-xs font-bold text-[var(--color-text-secondary)]"
            >
              Yeni çalışma grubu
            </label>

            <div class="flex gap-2">
              <input
                id="workspace-name"
                v-model="newWorkspaceName"
                type="text"
                placeholder="Grup adı"
                maxlength="70"
                class="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
              />

              <button
                type="button"
                @click="createWorkspace"
                :disabled="!newWorkspaceName.trim() || workspaceLoading"
                class="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 active:scale-95 disabled:opacity-40"
              >
                Oluştur
              </button>
            </div>
          </div>

          <div
            class="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]"
          >
            <div
              class="h-px flex-1 bg-[var(--color-border)]"
            ></div>

            veya

            <div
              class="h-px flex-1 bg-[var(--color-border)]"
            ></div>
          </div>

          <div class="space-y-2">
            <label
              for="workspace-invite"
              class="block text-xs font-bold text-[var(--color-text-secondary)]"
            >
              Davet koduyla katıl
            </label>

            <div class="flex gap-2">
              <input
                id="workspace-invite"
                v-model="inviteCode"
                type="text"
                placeholder="Davet kodu"
                maxlength="20"
                class="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm uppercase outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
              />

              <button
                type="button"
                @click="joinWorkspace"
                :disabled="!inviteCode.trim() || workspaceLoading"
                class="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 active:scale-95 disabled:opacity-40"
              >
                Katıl
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Yeni çalışan -->
      <section
        v-if="workspace"
        class="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6"
        aria-labelledby="create-heading"
      >
        <div class="mb-5 flex items-center gap-3">
          <div
            class="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"
              />
              <circle
                cx="9.5"
                cy="7"
                r="4"
              />
              <path
                d="M19 8v6m-3-3h6"
              />
            </svg>
          </div>

          <div>
            <h2
              id="create-heading"
              class="text-base font-black tracking-tight"
            >
              Yeni çalışan
            </h2>

            <p
              class="text-xs text-[var(--color-text-secondary)]"
            >
              Ekibine yeni bir hesap ekle
            </p>
          </div>
        </div>

        <form
          class="space-y-3.5"
          @submit.prevent="createUser"
        >
          <div>
            <label
              for="new-username"
              class="mb-1.5 block text-xs font-bold text-[var(--color-text-secondary)]"
            >
              Kullanıcı adı
            </label>

            <input
              id="new-username"
              v-model="newUsername"
              type="text"
              maxlength="25"
              autocomplete="off"
              placeholder="Örn. ayse"
              class="w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5 text-sm outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            />
          </div>

          <div>
            <label
              for="new-pin"
              class="mb-1.5 block text-xs font-bold text-[var(--color-text-secondary)]"
            >
              Giriş PIN'i
            </label>

            <input
              id="new-pin"
              v-model="newPin"
              type="password"
              maxlength="25"
              autocomplete="new-password"
              placeholder="Güvenli bir PIN belirle"
              class="w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5 text-sm outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            />
          </div>

          <button
            type="submit"
            :disabled="!newUsername.trim() || !newPin || createLoading"
            class="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-700/15 transition hover:bg-indigo-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
          >
            <svg
              v-if="!createLoading"
              viewBox="0 0 24 24"
              class="size-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14m-7-7h14" />
            </svg>

            {{
              createLoading
                ? "Oluşturuluyor..."
                : "Çalışan oluştur"
            }}
          </button>

          <p
            class="text-center text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
          >
            Yeni hesap bu çalışma grubuna bağlı olacaktır.
          </p>
        </form>
      </section>

      <!-- Aktif ekip üyeleri -->
      <section
        v-if="workspace"
        class="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6"
        aria-labelledby="members-heading"
      >
        <div
          class="mb-5 flex items-center justify-between gap-3"
        >
          <div class="flex items-center gap-3">
            <div
              class="grid size-11 shrink-0 place-items-center rounded-2xl bg-violet-500/10 text-violet-600 dark:text-violet-400"
            >
              <svg
                viewBox="0 0 24 24"
                class="size-5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path
                  d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
                />
                <circle cx="8.5" cy="7" r="4" />
                <path
                  d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
                />
              </svg>
            </div>

            <div>
              <h2
                id="members-heading"
                class="text-base font-black tracking-tight"
              >
                Ekip üyeleri
              </h2>

              <p
                class="text-xs text-[var(--color-text-secondary)]"
              >
                Yalnızca aktif hesaplar
              </p>
            </div>
          </div>

          <button
            type="button"
            @click="fetchUsers"
            :disabled="loading || deactivationLoading"
            aria-label="Üye listesini yenile"
            title="Listeyi yenile"
            class="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"
              />
            </svg>
          </button>
        </div>

        <!-- Yüklenme -->
        <div
          v-if="loading"
          role="status"
          class="rounded-2xl bg-[var(--color-surface)] px-4 py-7 text-center text-sm text-[var(--color-text-secondary)]"
        >
          Üyeler yükleniyor...
        </div>

        <!-- Hata -->
        <div
          v-else-if="usersLoadError"
          role="alert"
          class="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300"
        >
          Üye listesi alınamadı.
          Bağlantını kontrol edip yenile.
        </div>

        <!-- Boş liste -->
        <div
          v-else-if="sameWorkspaceUsers.length === 0"
          class="rounded-2xl border border-dashed border-[var(--color-border)] p-7 text-center"
        >
          <div
            class="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M5 21a7 7 0 0 1 14 0" />
            </svg>
          </div>

          <p class="text-sm font-bold">
            Henüz aktif üye görünmüyor
          </p>

          <p
            class="mt-1 text-xs text-[var(--color-text-secondary)]"
          >
            Yukarıdan yeni bir çalışan ekleyebilirsin.
          </p>
        </div>

        <!-- Üye listesi -->
        <div
          v-else
          class="space-y-2"
        >
          <div
            v-for="user in sameWorkspaceUsers"
            :key="user.id"
            class="group flex items-center gap-3 rounded-2xl border border-[var(--color-border)] p-3 transition hover:border-indigo-500/20 hover:bg-indigo-500/[0.025] sm:p-3.5"
          >
            <!-- Avatar -->
            <div
              class="grid size-11 shrink-0 place-items-center rounded-2xl text-sm font-black"
              :class="
                user.role === 'manager'
                  ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                  : user.role === 'superadmin'
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
                    : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
              "
              aria-hidden="true"
            >
              {{
                user.username
                  ?.charAt(0)
                  ?.toLocaleUpperCase("tr-TR") || "?"
              }}
            </div>

            <!-- Kullanıcı bilgileri -->
            <div class="min-w-0 flex-1">
              <p
                class="truncate text-sm font-extrabold"
              >
                {{ user.username }}
              </p>

              <span
                class="mt-0.5 inline-block text-[11px] font-semibold"
                :class="
                  user.role === 'manager'
                    ? 'text-violet-600 dark:text-violet-300'
                    : user.role === 'superadmin'
                      ? 'text-amber-600 dark:text-amber-300'
                      : 'text-indigo-600 dark:text-indigo-300'
                "
              >
                {{
                  user.role === "manager"
                    ? "Yönetici"
                    : user.role === "superadmin"
                      ? "Süper yönetici"
                      : "Çalışan"
                }}
              </span>
            </div>

            <!-- Yalnızca çalışan hesabı kapatılabilir -->
            <button
              v-if="
                user.role === 'worker' &&
                user.id !== getUser()?.id
              "
              type="button"
              @click="requestDeactivation(user)"
              :disabled="
                deactivationLoading ||
                !!pendingDeactivation ||
                uncertainUserIds.has(user.id)
              "
              :aria-label="
                uncertainUserIds.has(user.id)
                  ? `${user.username} için işlem durumu doğrulanmalı`
                  : `${user.username} hesabını devre dışı bırak`
              "
              :title="
                uncertainUserIds.has(user.id)
                  ? 'İşlem durumu doğrulanmalı'
                  : 'Hesabı devre dışı bırak'
              "
              class="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs font-extrabold text-rose-600 transition hover:border-rose-500/40 hover:bg-rose-500/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 dark:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
            >
              <svg
                viewBox="0 0 24 24"
                class="size-4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="10" cy="8" r="4" />
                <path
                  d="M3 21v-2a7 7 0 0 1 13-3.5M17 18h5"
                />
              </svg>

              <span
                v-if="uncertainUserIds.has(user.id)"
              >
                Kontrol gerekli
              </span>

              <template v-else>
                <span class="hidden sm:inline">
                  Devre dışı bırak
                </span>

                <span class="sm:hidden">
                  Kapat
                </span>
              </template>
            </button>

            <span
              v-else
              class="shrink-0 rounded-full bg-[var(--color-surface)] px-3 py-1.5 text-[10px] font-semibold text-[var(--color-text-secondary)]"
            >
              Korunuyor
            </span>
          </div>
        </div>

        <!-- Belirsiz işlem durumu -->
        <p
          v-if="uncertainUserIds.size > 0"
          role="alert"
          class="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200"
        >
          Bazı hesap kapatma işlemlerinin sonucu doğrulanamadı.
          Sunucu durumunu kontrol etmeden tekrar deneme.
        </p>

        <!-- Bilgilendirme -->
        <p
          class="mt-4 rounded-xl bg-indigo-500/5 px-3.5 py-3 text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
        >
          Devre dışı bırakılan çalışanlar bu aktif listeden
          çıkar. Kişisel kayıtları veritabanında arşivlenir;
          arşiv görüntüleme ekranı henüz mevcut değil.
        </p>
      </section>
    </main>

    <!-- Hesap kapatma onay penceresi -->
    <Teleport to="body">
      <div
        v-if="pendingDeactivation"
        class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
        @keydown.esc.stop.prevent="cancelDeactivation"
      >
        <!-- Arka plan -->
        <div
          class="absolute inset-0 bg-slate-950/65 backdrop-blur-[6px]"
          aria-hidden="true"
          @click="cancelDeactivation"
        ></div>

        <!-- Modal -->
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivation-title"
          aria-describedby="deactivation-description"
          class="relative w-full max-w-md rounded-t-[30px] border border-[var(--color-border)] bg-[var(--color-card)] p-6 text-[var(--color-text-primary)] shadow-2xl sm:rounded-[30px] sm:p-7"
        >
          <div
            class="mb-4 grid size-14 place-items-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-7"
              fill="none"
              stroke="currentColor"
              stroke-width="1.65"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="10" cy="8" r="4" />

              <path
                d="M3 21v-2a7 7 0 0 1 13-3.5M17 18h5"
              />
            </svg>
          </div>

          <h2
            id="deactivation-title"
            class="text-xl font-black tracking-tight"
          >
            Hesap devre dışı bırakılsın mı?
          </h2>

          <p
            id="deactivation-description"
            class="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]"
          >
            <strong
              class="font-extrabold text-[var(--color-text-primary)]"
            >
              {{ pendingDeactivation.username }}
            </strong>

            artık giriş yapamayacak; açık oturumları
            sonlandırılacak. Şirkete ait kişisel sayaçları
            silinmeden arşivlenecek, paylaşılan sayaçlar
            korunacak.
          </p>

          <div
            class="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200"
          >
            <strong>Önemli:</strong>
            Bu hesap yeniden etkinleştirilemez.
            Arşiv kayıtları korunur ancak henüz
            panelden görüntülenemez.
          </div>

          <div
            class="mt-6 grid grid-cols-2 gap-3"
          >
            <button
              ref="cancelDeactivationButton"
              type="button"
              @click="cancelDeactivation"
              :disabled="deactivationLoading"
              class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3.5 text-sm font-bold transition hover:brightness-95 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              Vazgeç
            </button>

            <button
              type="button"
              @click="confirmDeactivation"
              :disabled="deactivationLoading"
              class="rounded-2xl bg-rose-600 px-3 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-rose-700/15 transition hover:bg-rose-700 active:scale-[0.98] disabled:cursor-wait disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
            >
              {{
                deactivationLoading
                  ? "İşleniyor..."
                  : "Devre dışı bırak"
              }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
