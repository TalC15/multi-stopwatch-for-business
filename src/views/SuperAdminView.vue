<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from '@/composables/message';
import { apiFetch, getAccessToken } from '@/services/backendSync';

const router = useRouter();
const BASE_URL = "https://multi-stopwatch-backend.onrender.com";

const users = ref([]);
const workspaces = ref([]);
const loading = ref(false);
const createLoading = ref(false);
const editingUser = ref(null);

const newUsername = ref('');
const newPin = ref('');
const newRole = ref('worker');
const newWorkspaceId = ref('');

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

async function fetchAll() {
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
}

async function createUser() {
  if (!newUsername.value || !newPin.value) return;
  createLoading.value = true;

  const response = await apiFetch(`${BASE_URL}/users/create`, {
    method: 'POST',
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
      newUsername.value = '';
      newPin.value = '';
      newRole.value = 'worker';
      newWorkspaceId.value = '';
      await fetchAll();
    } else {
      message.warning(data.error || 'Kullanıcı oluşturulamadı');
    }
  }
  createLoading.value = false;
}

async function deleteUser(userId, username) {
  const response = await apiFetch(`${BASE_URL}/admin/users/${userId}`, {
    method: 'DELETE',
    headers: authHeader(),
  });

  if (response?.ok) {
    message.success(`${username} silindi`);
    await fetchAll();
  } else {
    message.warning('Kullanıcı silinemedi');
  }
}

async function updateUser() {
  if (!editingUser.value) return;

  const response = await apiFetch(`${BASE_URL}/admin/users/${editingUser.value.id}`, {
    method: 'PATCH',
    headers: authHeader(),
    body: JSON.stringify({
      username: editingUser.value.username,
      role: editingUser.value.role,
      workspace_id: editingUser.value.workspace_id || null,
    }),
  });

  if (response?.ok) {
    message.success('Kullanıcı güncellendi');
    editingUser.value = null;
    await fetchAll();
  } else {
    message.warning('Kullanıcı güncellenemedi');
  }
}

function workspaceName(id) {
  const ws = workspaces.value.find(w => w.id === id);
  return ws ? ws.name : '-';
}


async function fetchWorkspaceDetail(wsId) {
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
}

function closeModal() {
  showModal.value = false;
  workspaceDetail.value = null;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('tr-TR');
}

onMounted(() => fetchAll());
</script>

<template>
  <div class="min-h-screen bg-[var(--color-surface)]">

    <nav class="h-14 bg-[var(--color-card)] border-b border-[var(--color-border)] px-4 flex items-center justify-between sticky top-0 z-30">
      <button @click="router.push('/')" class="w-9 h-9 flex items-center justify-center text-[var(--color-primary-light)] active:scale-90 transition-transform">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>
      <h1 class="text-lg font-black text-[var(--color-primary-light)]">Süper Admin</h1>
      <div class="w-9"></div>
    </nav>

    <main class="max-w-md mx-auto px-4 pt-6 pb-12 flex flex-col gap-6">

      <!-- Yeni Kullanıcı -->
      <div class="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] p-5 flex flex-col gap-4">
        <h2 class="text-sm font-black tracking-widest uppercase text-[var(--color-text-muted)]">Yeni Kullanıcı</h2>

        <input v-model="newUsername" type="text" placeholder="Kullanıcı adı"
          class="px-4 py-3 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] focus:outline-none text-sm" />

        <input v-model="newPin" type="password" placeholder="PIN"
          class="px-4 py-3 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] focus:outline-none text-sm" />

        <div class="flex gap-2">
          <button v-for="role in ['worker', 'manager', 'superadmin']" :key="role"
            @click="newRole = role"
            :class="[
              'flex-1 py-2 rounded-xl text-xs font-bold transition border',
              newRole === role
                ? 'bg-indigo-700 text-white border-indigo-700'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
            ]">
            {{ role }}
          </button>
        </div>

        <select v-model="newWorkspaceId"
          class="px-4 py-3 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] focus:outline-none text-sm">
          <option value="">Workspace yok</option>
          <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">{{ ws.name }}</option>
        </select>

        <button @click="createUser" :disabled="!newUsername || !newPin || createLoading"
          class="w-full py-3 rounded-2xl bg-indigo-700 text-white font-bold transition active:scale-95 disabled:opacity-40">
          {{ createLoading ? 'Oluşturuluyor...' : 'Oluştur' }}
        </button>
      </div>

      <!-- Kullanıcı Listesi -->
      <div class="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] p-5 flex flex-col gap-3">
        <h2 class="text-sm font-black tracking-widest uppercase text-[var(--color-text-muted)]">Tüm Kullanıcılar</h2>

        <div v-if="loading" class="text-center py-4 text-[var(--color-text-muted)] text-sm">Yükleniyor...</div>

        <div v-for="user in users" :key="user.id"
          class="flex flex-col gap-2 py-3 border-b border-[var(--color-border)] last:border-0">

          <!-- Normal görünüm -->
          <div v-if="editingUser?.id !== user.id" class="flex items-center justify-between">
            <div class="flex flex-col gap-0.5">
              <span class="font-medium text-[var(--color-text-primary)] text-sm">{{ user.username }}</span>
              <span class="text-xs text-[var(--color-text-muted)]">{{ user.role }} — {{ workspaceName(user.workspace_id) }}</span>
            </div>
            <div class="flex gap-2">
              <button @click="editingUser = { ...user }"
                class="w-8 h-8 flex items-center justify-center text-indigo-500 hover:text-indigo-700 transition">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button @click="deleteUser(user.id, user.username)"
                class="w-8 h-8 flex items-center justify-center text-red-500 hover:text-red-700 transition">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Düzenleme görünümü -->
          <div v-else class="flex flex-col gap-2">
            <input v-model="editingUser.username" type="text"
              class="px-3 py-2 rounded-xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] text-sm focus:outline-none" />
            <div class="flex gap-2">
              <button v-for="role in ['worker', 'manager', 'superadmin']" :key="role"
                @click="editingUser.role = role"
                :class="[
                  'flex-1 py-1.5 rounded-xl text-xs font-bold transition border',
                  editingUser.role === role
                    ? 'bg-indigo-700 text-white border-indigo-700'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
                ]">
                {{ role }}
              </button>
            </div>
            <select v-model="editingUser.workspace_id"
              class="px-3 py-2 rounded-xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] text-sm">
              <option value="">Workspace yok</option>
              <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">{{ ws.name }}</option>
            </select>
            <div class="flex gap-2">
              <button @click="editingUser = null"
                class="flex-1 py-2 rounded-xl text-sm border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                İptal
              </button>
              <button @click="updateUser"
                class="flex-1 py-2 rounded-xl text-sm bg-indigo-700 text-white font-bold">
                Kaydet
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Workspace Listesi -->
      <!-- Workspace Listesi -->
<div class="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] p-5 flex flex-col gap-3">
  <h2 class="text-sm font-black tracking-widest uppercase text-[var(--color-text-muted)]">Workspace'ler</h2>
  <div v-if="workspaces.length === 0" class="text-center py-4 text-[var(--color-text-muted)] text-sm">Henüz workspace yok</div>
  <div
    v-for="ws in workspaces"
    :key="ws.id"
    @click="fetchWorkspaceDetail(ws.id)"
    class="flex items-center justify-between py-3 border-b border-[var(--color-border)] last:border-0 cursor-pointer hover:bg-[var(--color-surface)] rounded-xl px-2 transition"
  >
    <span class="text-sm font-medium text-[var(--color-text-primary)]">{{ ws.name }}</span>
    <div class="flex items-center gap-2">
      <span class="text-xs font-black text-[var(--color-primary-light)] tracking-widest">{{ ws.invite_code }}</span>
      <svg class="w-4 h-4 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
    </div>
  </div>
</div>

<!-- Workspace Detay Modal -->
<div v-if="showModal" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
  <div @click="closeModal" class="absolute inset-0 bg-black/60 backdrop-blur-md"></div>

  <div class="relative w-full max-w-md bg-[var(--color-card)] rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl flex flex-col gap-4 max-h-[80vh] overflow-y-auto">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-black text-[var(--color-text-primary)]">
        {{ workspaceDetail?.workspace?.name }}
      </h2>
      <button @click="closeModal" class="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div v-if="detailLoading" class="text-center py-8 text-[var(--color-text-muted)] text-sm">Yükleniyor...</div>

    <div v-else-if="workspaceDetail" class="flex flex-col gap-4">

      <!-- Bilgiler -->
      <div class="flex flex-col gap-2 bg-[var(--color-surface)] rounded-xl p-4">
        <div class="flex justify-between text-sm">
          <span class="text-[var(--color-text-muted)]">Davet Kodu</span>
          <span class="font-black text-[var(--color-primary-light)] tracking-widest">{{ workspaceDetail.workspace.invite_code }}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-[var(--color-text-muted)]">Oluşturulma</span>
          <span class="font-medium text-[var(--color-text-primary)]">{{ formatDate(workspaceDetail.workspace.created_at) }}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-[var(--color-text-muted)]">Üye Sayısı</span>
          <span class="font-medium text-[var(--color-text-primary)]">{{ workspaceDetail.members.length }}</span>
        </div>
      </div>

      <!-- Üyeler -->
      <div class="flex flex-col gap-2">
        <h3 class="text-xs font-black tracking-widest uppercase text-[var(--color-text-muted)]">Üyeler</h3>
        <div v-if="workspaceDetail.members.length === 0" class="text-center py-4 text-[var(--color-text-muted)] text-sm">
          Henüz üye yok
        </div>
        <div
          v-for="member in workspaceDetail.members"
          :key="member.id"
          class="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0"
        >
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium text-[var(--color-text-primary)]">{{ member.username }}</span>
            <span class="text-xs text-[var(--color-text-muted)]">{{ member.role }}</span>
          </div>
          <span class="text-xs text-[var(--color-text-muted)]">{{ formatDate(member.created_at) }}</span>
        </div>
      </div>

    </div>
  </div>
</div>
    </main>
  </div>
</template>