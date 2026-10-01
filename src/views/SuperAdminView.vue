<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/composables/message";
import { apiFetch, getAccessToken } from "@/services/backendSync";
import { useStopwatchStore } from "../stores/stopwatchStore";

const router = useRouter();
const BASE_URL = "https://multi-stopwatch-backend.onrender.com";

const store = useStopwatchStore();
const users = ref([]);
const workspaces = ref([]);
const loading = ref(false);
const createLoading = ref(false);
const editingUser = ref(null);

const newUsername = ref("");
const newPin = ref("");
const newRole = ref("worker");
const newWorkspaceId = ref("");

const selectedWorkspace = ref(null);
const workspaceDetail = ref(null);
const detailLoading = ref(false);
const showModal = ref(false);

function authHeader() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getAccessToken()}`,
  };
}

const fetchAll = message.withLoading("Yönetim verileri yükleniyor...", async () => {
  loading.value = true;
  const [usersRes, workspacesRes] = await Promise.all([
    apiFetch(`${BASE_URL}/admin/users`, { headers: authHeader() }),
    apiFetch(`${BASE_URL}/admin/workspaces`, { headers: authHeader() }),
  ]);

  if (usersRes) {
    const data = await usersRes.json();
    users.value = data.users || [];
  }
  if (workspacesRes) {
    const data = await workspacesRes.json();
    workspaces.value = data.workspaces || [];
  }
  loading.value = false;
});

const createUser = message.withLoading("Kullanıcı oluşturuluyor...", async () => {
  if (!newUsername.value || !newPin.value) return;
  if (newUsername.value.length > 25 || newPin.value.length > 25)
    return message.error("çok uzun isim veya PIN");
  createLoading.value = true;

  const response = await apiFetch(`${BASE_URL}/users/create`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({
      username: newUsername.value,
      pin: newPin.value,
      role: newRole.value,
      workspace_id: newWorkspaceId.value || null,
    }),
  });

  if (response) {
    const data = await response.json();
    if (response.ok) {
      message.success(`${newUsername.value} oluşturuldu`);
      newUsername.value = "";
      newPin.value = "";
      newRole.value = "worker";
      newWorkspaceId.value = "";
      await fetchAll();
    } else {
      message.error(data.error || "Kullanıcı oluşturulamadı");
    }
  }
  createLoading.value = false;
});

const deleteUser = message.withLoading("Kullanıcı siliniyor...", async (userId, username) => {
  const response = await apiFetch(`${BASE_URL}/admin/users/${userId}`, {
    method: "DELETE",
    headers: authHeader(),
  })

  if (response?.ok) {
    message.success(`${username} silindi`);
    await fetchAll();
  } else {
    message.error("Kullanıcı silinemedi");
  }
});

const forceLogout = message.withLoading("Kullanıcının oturumu kapatılıyor...", async (userId, username) => {
  const response = await apiFetch(`${BASE_URL}/users/${userId}/force-logout`, {
    method: "POST",
    headers: authHeader(),
  });

  if (response?.ok) {
    message.success(`${username} kullanıcısının oturumu kapatıldı`);
  } else {
    const data = response ? await response.json() : null;
    message.error(data?.error || "Oturum kapatılamadı");
  }
});

const updateUser = message.withLoading("Kullanıcı güncelleniyor...", async () => {
  if (!editingUser.value) return;

  const response = await apiFetch(
    `${BASE_URL}/admin/users/${editingUser.value.id}`,
    {
      method: "PATCH",
      headers: authHeader(),
      body: JSON.stringify({
        username: editingUser.value.username,
        role: editingUser.value.role,
        workspace_id: editingUser.value.workspace_id || null,
      }),
    },
  );

  if (response?.ok) {
    message.success("Kullanıcı güncellendi");
    editingUser.value = null;
    await fetchAll();
  } else {
    message.error("Kullanıcı güncellenemedi");
  }
});

function workspaceName(id) {
  const ws = workspaces.value.find((w) => w.id === id);
  return ws ? ws.name : "-";
}

const fetchWorkspaceDetail = message.withLoading("Çalışma grubu ayrıntıları yükleniyor...", async (wsId) => {
  detailLoading.value = true;
  showModal.value = true;

  const response = await apiFetch(`${BASE_URL}/admin/workspaces/${wsId}`, {
    headers: authHeader(),
  });

  if (response) {
    const data = await response.json();
    workspaceDetail.value = data;
  }
  detailLoading.value = false;
});

function closeModal() {
  showModal.value = false;
  workspaceDetail.value = null;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("tr-TR");
}

onMounted(() => fetchAll());
</script>

<template>
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
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>
      <div class="min-w-0 text-center">
        <p
          class="text-[10px] font-black tracking-[0.26em] text-indigo-500 uppercase"
        >
          KeepTimer
        </p>

        <h1 class="text-sm font-extrabold tracking-tight sm:text-base">
          Süper Admin Paneli
        </h1>
      </div>
      <div class="size-10" aria-hidden="true"></div>
    </nav>

    <main class="mx-auto flex max-w-md flex-col gap-5 px-4 pt-6 pb-12 sm:px-6">
      <!-- Yeni kullanıcı -->
      <div
        class="flex flex-col gap-4 rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6"
      >
        <h2 class="text-base font-black tracking-tight">Yeni kullanıcı</h2>

        <input
          v-model="newUsername"
          type="text"
          aria-label="Kullanıcı adı"
          placeholder="Kullanıcı adı"
          maxlength="25"
          class="min-w-0 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
        />

        <input
          v-model="newPin"
          type="password"
          aria-label="Giriş PIN’i"
          placeholder="PIN"
          maxlength="25"
          class="min-w-0 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
        />

        <div class="flex gap-2">
          <button
            v-for="role in ['worker', 'manager', 'superadmin']"
            :key="role"
            :aria-pressed="newRole === role"
            @click="newRole = role"
            :class="[
              'min-w-0 flex-1 rounded-xl border px-1 py-2.5 text-[10px] font-bold capitalize sm:text-[11px] transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
              newRole === role
                ? role === 'manager'
                  ? 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300'
                  : role === 'superadmin'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                    : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-indigo-500/20 hover:bg-indigo-500/5',
            ]"
          >
            {{ role }}
          </button>
        </div>

        <select
          v-model="newWorkspaceId"
          aria-label="Yeni kullanıcının çalışma grubu"
          class="min-w-0 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
        >
          <option value="">Workspace yok</option>
          <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">
            {{ ws.name }}
          </option>
        </select>

        <button
          @click="createUser"
          :disabled="!newUsername || !newPin || createLoading"
          class="w-full rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40 disabled:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        >
          {{ createLoading ? "Oluşturuluyor..." : "Oluştur" }}
        </button>
      </div>

      <!-- Kullanıcı Listesi -->
      <div
        class="flex flex-col gap-3 rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6"
      >
        <h2 class="text-base font-black tracking-tight">Tüm kullanıcılar</h2>

        <div
          v-if="loading"
          class="rounded-2xl bg-[var(--color-surface)] py-5 text-center text-sm text-[var(--color-text-secondary)]"
        >
          Yükleniyor...
        </div>

        <div
          v-for="user in users"
          :key="user.id"
          class="flex flex-col gap-2 rounded-2xl border border-[var(--color-border)] p-3 transition hover:border-indigo-500/20"
        >
          <!-- Normal görünüm -->
          <div
            v-if="editingUser?.id !== user.id"
            class="flex items-center gap-2.5"
          >
            <div
              class="grid size-10 shrink-0 place-items-center rounded-2xl text-sm font-black"
              :class="
                user.role === 'manager'
                  ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                  : user.role === 'superadmin'
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
                    : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
              "
              aria-hidden="true"
            >
              {{ user.username?.charAt(0)?.toLocaleUpperCase("tr-TR") || "?" }}
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                class="truncate text-sm font-extrabold text-[var(--color-text-primary)]"
                >{{ user.username }}</span
              >
              <span
                class="truncate text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
                ><span
                  :class="[store.roleStyles[user?.role].text, 'text-[11px]']"
                  >{{ user?.role }}</span
                >
                — {{ workspaceName(user.workspace_id) }}</span
              >
            </div>
            <div class="flex shrink-0 gap-1">
              <button
                type="button"
                title="Oturumu sonlandır"
                aria-label="Oturumu sonlandır"
                @click="forceLogout(user.id, user.username)"
                class="grid size-8 shrink-0 place-items-center rounded-xl border border-amber-500/15 bg-amber-500/5 text-amber-600 transition hover:border-amber-500/30 hover:bg-amber-500/10 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:text-amber-400"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </button>
              <button
                type="button"
                title="Kullanıcıyı düzenle"
                aria-label="Kullanıcıyı düzenle"
                @click="editingUser = { ...user }"
                class="grid size-8 shrink-0 place-items-center rounded-xl border border-indigo-500/15 bg-indigo-500/5 text-indigo-600 transition hover:border-indigo-500/30 hover:bg-indigo-500/10 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-400"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </button>
              <button
                type="button"
                title="Kullanıcıyı sil"
                aria-label="Kullanıcıyı sil"
                @click="deleteUser(user.id, user.username)"
                class="grid size-8 shrink-0 place-items-center rounded-xl border border-rose-500/15 bg-rose-500/5 text-rose-600 transition hover:border-rose-500/30 hover:bg-rose-500/10 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:text-rose-400"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          </div>

          <!-- Düzenleme görünümü -->
          <div
            v-else
            class="flex flex-col gap-3 rounded-xl bg-[var(--color-surface)] p-3"
          >
            <input
              v-model="editingUser.username"
              type="text"
              aria-label="Kullanıcı adı"
              class="min-w-0 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            />
            <div class="flex gap-2">
              <button
                v-for="role in ['worker', 'manager', 'superadmin']"
                :key="role"
                :aria-pressed="editingUser.role === role"
                @click="editingUser.role = role"
                :class="[
                  'min-w-0 flex-1 rounded-xl border px-1 py-2.5 text-[10px] font-bold capitalize sm:text-[11px] transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
                  editingUser.role === role
                    ? role === 'manager'
                      ? 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300'
                      : role === 'superadmin'
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                        : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-indigo-500/20 hover:bg-indigo-500/5',
                ]"
              >
                {{ role }}
              </button>
            </div>
            <select
              v-model="editingUser.workspace_id"
              aria-label="Kullanıcının çalışma grubu"
              class="min-w-0 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            >
              <option value="">Workspace yok</option>
              <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">
                {{ ws.name }}
              </option>
            </select>
            <div class="flex gap-2">
              <button
                @click="editingUser = null"
                class="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] py-2.5 text-sm font-semibold text-[var(--color-text-secondary)] transition hover:bg-indigo-500/5 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-indigo-500"
              >
                İptal
              </button>
              <button
                @click="updateUser"
                class="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                Kaydet
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Workspace Listesi -->
      <div
        class="flex flex-col gap-3 rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6"
      >
        <h2 class="text-base font-black tracking-tight">Çalışma grupları</h2>
        <div
          v-if="workspaces.length === 0"
          class="rounded-2xl bg-[var(--color-surface)] py-5 text-center text-sm text-[var(--color-text-secondary)]"
        >
          Henüz workspace yok
        </div>
        <div
          v-for="ws in workspaces"
          :key="ws.id"
          @click="fetchWorkspaceDetail(ws.id)"
          class="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 transition hover:border-indigo-500/25 hover:bg-indigo-500/5 active:scale-[0.99]"
        >
          <span
            class="min-w-0 flex-1 truncate text-sm font-bold text-[var(--color-text-primary)]"
            >{{ ws.name }}</span
          >
          <div class="flex shrink-0 items-center gap-2">
            <span
              class="rounded-lg bg-indigo-500/10 px-2 py-1 font-mono text-[10px] font-bold tracking-wide text-indigo-600 dark:text-indigo-300"
              >{{ ws.invite_code }}</span
            >
            <svg
              class="w-4 h-4 text-[var(--color-text-muted)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </div>
        </div>
      </div>

      <!-- Workspace Detay Modal -->
      <div
        v-if="showModal"
        class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      >
        <div
          @click="closeModal"
          class="superadmin-backdrop absolute inset-0 bg-slate-950/65 backdrop-blur-[6px]"
        ></div>

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="superadmin-workspace-title"
          class="superadmin-dialog relative flex max-h-[80vh] w-full max-w-md flex-col gap-5 overflow-y-auto overscroll-contain rounded-t-[30px] border border-[var(--color-border)] bg-[var(--color-card)] p-6 text-[var(--color-text-primary)] shadow-2xl shadow-slate-950/20 sm:rounded-[28px] sm:p-7"
        >
          <div
            class="mx-auto -mt-3 h-1 w-10 shrink-0 rounded-full bg-[var(--color-border)] sm:hidden"
            aria-hidden="true"
          ></div>

          <!-- Header -->
          <div
            class="flex items-start justify-between gap-3 border-b border-[var(--color-border)] pb-4"
          >
            <div class="min-w-0">
              <p
                class="mb-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300"
              >
                Çalışma grubu detayları
              </p>
              <h2
                id="superadmin-workspace-title"
                class="text-xl font-black tracking-tight text-[var(--color-text-primary)] [overflow-wrap:anywhere]"
              >
                {{ workspaceDetail?.workspace?.name }}
              </h2>
            </div>
            <button
              type="button"
              aria-label="Pencereyi kapat"
              @click="closeModal"
              class="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition hover:bg-indigo-500/5 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div
            v-if="detailLoading"
            class="rounded-2xl bg-[var(--color-surface)] py-8 text-center text-sm text-[var(--color-text-secondary)]"
          >
            Yükleniyor...
          </div>

          <div v-else-if="workspaceDetail" class="flex flex-col gap-4">
            <!-- Bilgiler -->
            <div
              class="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
            >
              <div
                class="flex items-start justify-between gap-3 border-b border-[var(--color-border)] py-3 text-xs first:pt-1 last:border-0 last:pb-1 sm:text-sm"
              >
                <span class="text-[var(--color-text-muted)]">Davet Kodu</span>
                <span
                  class="rounded-lg bg-indigo-500/10 px-2 py-1 text-right font-mono text-xs font-bold tracking-wide text-indigo-600 [overflow-wrap:anywhere] dark:text-indigo-300"
                  >{{ workspaceDetail.workspace.invite_code }}</span
                >
              </div>
              <div
                class="flex items-start justify-between gap-3 border-b border-[var(--color-border)] py-3 text-xs first:pt-1 last:border-0 last:pb-1 sm:text-sm"
              >
                <span class="text-[var(--color-text-muted)]">Oluşturulma</span>
                <span
                  class="text-right font-semibold text-[var(--color-text-primary)] tabular-nums"
                  >{{ formatDate(workspaceDetail.workspace.created_at) }}</span
                >
              </div>
              <div
                class="flex items-start justify-between gap-3 border-b border-[var(--color-border)] py-3 text-xs first:pt-1 last:border-0 last:pb-1 sm:text-sm"
              >
                <span class="text-[var(--color-text-muted)]">Üye Sayısı</span>
                <span
                  class="text-right font-semibold text-[var(--color-text-primary)] tabular-nums"
                  >{{ workspaceDetail.members.length }}</span
                >
              </div>
            </div>

            <!-- Üyeler -->
            <div class="flex flex-col gap-2">
              <h3 class="mb-1 text-sm font-extrabold tracking-tight">Üyeler</h3>
              <div
                v-if="workspaceDetail.members.length === 0"
                class="rounded-2xl bg-[var(--color-surface)] py-5 text-center text-sm text-[var(--color-text-secondary)]"
              >
                Henüz üye yok
              </div>
              <div
                v-for="member in workspaceDetail.members"
                :key="member.id"
                class="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] p-3"
              >
                <div
                  class="grid size-10 shrink-0 place-items-center rounded-2xl text-sm font-black"
                  :class="
                    member.role === 'manager'
                      ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                      : member.role === 'superadmin'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
                        : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                  "
                  aria-hidden="true"
                >
                  {{
                    member.username?.charAt(0)?.toLocaleUpperCase("tr-TR") ||
                    "?"
                  }}
                </div>
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    class="truncate text-sm font-bold text-[var(--color-text-primary)]"
                    >{{ member.username }}</span
                  >
                  <span
                    :class="[
                      store.roleStyles[member?.role].text,
                      'text-[11px]',
                    ]"
                    >{{ member.role }}</span
                  >
                </div>
                <span
                  class="max-w-24 shrink-0 text-right text-[10px] leading-relaxed text-[var(--color-text-secondary)] tabular-nums sm:max-w-none sm:text-[11px]"
                  >{{ formatDate(member.created_at) }}</span
                >
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .superadmin-backdrop {
    animation: superadmin-backdrop-in 180ms ease-out both;
  }

  .superadmin-dialog {
    animation: superadmin-dialog-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}

@keyframes superadmin-backdrop-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes superadmin-dialog-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
