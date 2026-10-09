// Exact success contracts from /register, /telegram/cancel and /telegram/control.
const isResponse = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const isTelegramBindSuccess = value => isResponse(value) && value.success === true;
export const isTelegramUnlinkSuccess = value => isResponse(value) && value.success === 'telegram bağlantısı kesildi.';
export const isTelegramStatusSuccess = value => isResponse(value) && value.success === true && typeof value.connected === 'boolean';
export const telegramUnverifiedMessage = 'Telegram işleminin sonucu doğrulanamadı. Bağlantı durumunu yeniden kontrol edin.';
