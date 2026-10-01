# KeepTimer

Vue + Vite PWA / Capacitor Android zamanlayıcı uygulaması.

```bash
npm ci
npm run dev
```

Doğrulama: `npm test` · Production: `npm run build`

Android kaynak aktarımı ve senkronizasyonu: `npm run android:sync`.
Öncesinde `android/` klasörü bulunmalıdır; yoksa `npm run build` ve `npx cap add android` çalıştırın.

Bildirim/ses değişiklikleri, logo entegrasyonu, platform sınırları ve cihaz kontrol listesi:
[docs/BILDIRIM_SES_IYILESTIRMELERI.md](docs/BILDIRIM_SES_IYILESTIRMELERI.md).

İlk patch üzerine ses ayarları ve eşzamanlı alarm/TTS güncellemesi:
[docs/SES_AYARLARI_EK_PATCH.md](docs/SES_AYARLARI_EK_PATCH.md).
