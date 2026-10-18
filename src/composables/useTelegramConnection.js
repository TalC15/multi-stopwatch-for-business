import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { accountExperience } from '../services/accountExperience.js';
import { message } from './message.js';
import { captureWorkspaceSession } from '../services/workspaceSession.js';
import { getUser, telegramControl, saveTelegramChatId, cancelTelegramChatId } from '../services/backendSync.js';
import { isTelegramBindSuccess, isTelegramUnlinkSuccess, isTelegramStatusSuccess } from '../services/telegramResponses.js';

// Shared view lifecycle, not an authority cache. Every operation is still checked by the server.
export function useTelegramConnection() {
  const chatId = ref(''), connected = ref(null), busy = ref(false), error = ref(''), notice = ref(''), confirmed = ref(false), statusError = ref('');
  const canManage = computed(() => {
    const data = accountExperience.currentData.value;
    // Company Telegram belongs to the user even without a timer workspace.
    // Keep this display scope stable; bind still needs current feature authority.
    return data?.account.kind === 'company' || data?.account.kind === 'individual' && data.personal.readable === true;
  });
  let alive = true, revision = 0;
  async function run(action, userInitiated = action !== 'status') {
    if (busy.value || !canManage.value) return;
    const session = captureWorkspaceSession();
    if (!session.isCurrent()) return;
    const input = typeof chatId.value === 'string' ? chatId.value.trim()
      : Number.isSafeInteger(chatId.value) ? String(chatId.value) : '';
    if (action === 'bind' && !/^-?\d{1,20}$/.test(input)) {
      message.warning('Geçerli bir Telegram Chat ID girin.');
      return;
    }
    const operation = ++revision, current = () => alive && operation === revision && session.isCurrent();
    busy.value = true; error.value = ''; notice.value = ''; statusError.value = '';
    try {
      if (action === 'bind' && (!await accountExperience.requireFeature('telegram') || !current())) {
        if (current()) { error.value = 'Yeni bağlantı için aktif abonelik ve internet bağlantısı gerekiyor.'; message.warning(error.value); }
        return;
      }
      const result = await (action === 'bind' ? saveTelegramChatId(input) : action === 'unlink' ? cancelTelegramChatId(getUser()?.id) : telegramControl(getUser()?.id));
      if (!current()) return;
      if (action === 'status' ? !isTelegramStatusSuccess(result) : action === 'bind' ? !isTelegramBindSuccess(result) : !isTelegramUnlinkSuccess(result)) {
        throw Error(result?.error === 'Geçersiz Chat ID' ? 'invalid-chat' : 'unconfirmed');
      }
      connected.value = action === 'status' ? result.connected : action === 'bind';
      confirmed.value = true;
      if (action === 'unlink') chatId.value = '';
      if (action !== 'status') {
        notice.value = action === 'bind' ? 'Telegram bağlandı.' : 'Telegram bağlantısı kaldırıldı.';
        message.success(notice.value);
      } else if (userInitiated) message.success('Telegram bağlantı durumu güncellendi.');
    } catch (failure) {
      if (current()) {
        confirmed.value = false;
        error.value = failure?.message === 'invalid-chat'
          ? 'Chat ID doğrulanamadı'
          : 'Telegram işlemi tamamlanamadı. Bağlantı durumunu yeniden kontrol edin.';
        if (userInitiated) message.error(error.value);
        else statusError.value = error.value;
      }
    } finally { if (alive && operation === revision) busy.value = false; }
  }
  watch(() => accountExperience.state.scopeVersion, () => {
    revision++; chatId.value = ''; connected.value = null; busy.value = false; error.value = ''; notice.value = ''; confirmed.value = false; statusError.value = '';
  }, { flush: 'sync' });
  watch(() => [accountExperience.state.scopeVersion, canManage.value], () => {
    if (canManage.value) void run('status');
  }, { flush: 'post' });
  onMounted(() => { if (canManage.value) void run('status'); });
  onBeforeUnmount(() => { alive = false; revision++; });
  return { chatId, telegramSaved: connected, telegramBusy: busy, telegramError: error, telegramNotice: notice,
    telegramConfirmed: confirmed, telegramStatusError: statusError, canManageTelegram: canManage,
    telegramSavedControl: () => run('status', true), saveTelegram: () => run('bind'), removeTelegram: () => run('unlink') };
}
