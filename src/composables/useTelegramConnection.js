import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { accountExperience } from '../services/accountExperience.js';
import { captureWorkspaceSession } from '../services/workspaceSession.js';
import { getUser, telegramControl, saveTelegramChatId, cancelTelegramChatId } from '../services/backendSync.js';
import { isTelegramBindSuccess, isTelegramUnlinkSuccess, isTelegramStatusSuccess } from '../services/telegramResponses.js';

// Shared view lifecycle, not an authority cache. Every operation is still checked by the server.
export function useTelegramConnection() {
  const chatId = ref(''), connected = ref(null), busy = ref(false), error = ref(''), notice = ref(''), confirmed = ref(false);
  const canManage = computed(() => {
    const data = accountExperience.currentData.value;
    // Company Telegram belongs to the user even without a timer workspace.
    // Keep this display scope stable; bind still needs current feature authority.
    return data?.account.kind === 'company' || data?.account.kind === 'individual' && data.personal.readable === true;
  });
  let alive = true, revision = 0;
  async function run(action) {
    if (busy.value || !canManage.value) return;
    const session = captureWorkspaceSession(), input = chatId.value;
    if (!session.isCurrent() || action === 'bind' && !String(input).trim()) return;
    const operation = ++revision, current = () => alive && operation === revision && session.isCurrent();
    busy.value = true; error.value = ''; notice.value = '';
    try {
      if (action === 'bind' && (!await accountExperience.requireFeature('telegram') || !current())) {
        if (current()) error.value = 'Yeni bağlantı için aktif abonelik ve internet bağlantısı gerekiyor.';
        return;
      }
      const result = await (action === 'bind' ? saveTelegramChatId(input) : action === 'unlink' ? cancelTelegramChatId(getUser()?.id) : telegramControl(getUser()?.id));
      if (!current()) return;
      if (action === 'status' ? !isTelegramStatusSuccess(result) : action === 'bind' ? !isTelegramBindSuccess(result) : !isTelegramUnlinkSuccess(result)) throw Error('unconfirmed');
      connected.value = action === 'status' ? result.connected : action === 'bind';
      confirmed.value = true;
      if (action === 'unlink') chatId.value = '';
      if (action !== 'status') notice.value = action === 'bind' ? 'Telegram bağlandı.' : 'Telegram bağlantısı kaldırıldı.';
    } catch {
      if (current()) { confirmed.value = false; error.value = 'Telegram işlemi tamamlanamadı. Bağlantı durumunu yeniden kontrol edin.'; }
    } finally { if (alive && operation === revision) busy.value = false; }
  }
  watch(() => accountExperience.state.scopeVersion, () => {
    revision++; chatId.value = ''; connected.value = null; busy.value = false; error.value = ''; notice.value = ''; confirmed.value = false;
  }, { flush: 'sync' });
  watch(() => [accountExperience.state.scopeVersion, canManage.value], () => {
    if (canManage.value) void run('status');
  }, { flush: 'post' });
  onMounted(() => { if (canManage.value) void run('status'); });
  onBeforeUnmount(() => { alive = false; revision++; });
  return { chatId, telegramSaved: connected, telegramBusy: busy, telegramError: error, telegramNotice: notice,
    telegramConfirmed: confirmed, canManageTelegram: canManage,
    telegramSavedControl: () => run('status'), saveTelegram: () => run('bind'), removeTelegram: () => run('unlink') };
}
