# KeepTimer — AI Engineering Changelog

> Amaç: Projede yapılan önemli değişiklikleri, nedenlerini, testlerini ve bilerek ertelenen işleri kalıcı biçimde kaydetmek.
>
> Kural: Bundan sonra onaylanan her proje değişikliğinden sonra bu dosyaya tarihli bir kayıt eklenir. Kayıt; ne değişti, neden değişti, hangi dosyalar etkilendi, hangi testler yapıldı ve neyin bilerek ertelendiğini içermelidir.

---

## 2026-09-25 — Phase 1: temiz üç modlu veri deposu temeli

### Neden

Uygulamanın eski `localStorage["timers"]` kayıtları yalnız geliştirme verisidir;
yeni sistem için korunmaları gerekmiyor. Yeni kullanıcının yerel ve offline
verileri ise devreye alındıktan sonra kalıcı ve kapsamı doğru olmalıdır.

### Değişenler

- `src/domain/timerDataMode.js`: `standalone`, `workspace-personal`, `shared`
  modları ve açık kullanıcı/workspace/oluşturucu bağlamı doğrulaması.
- `src/data/timerDb.js`: ayrı `keeptimer-data` IndexedDB'sinde Dexie v1
  `timers` tablosu; ilerideki şema sürümleri için normal version mekanizması.
- `src/data/timerRepository.js`: standalone yerel kayıt ve silme; kullanıcı ve
  workspace kapsamlı kişisel okuma/yazma; yalnız başarılı workspace sunucu
  görüntüsünden shared cache güncelleme. Timer ID'siyle mod, kullanıcı veya
  workspace değiştirilemez; shared yaratıcısının `userId` değeri sabittir.
- `src/data/timerRepository.test.js`: bağımsız mod, yeniden açılışta kalıcılık,
  hesap/workspace izolasyonu, hedef süresi ve shared snapshot sınırları testleri.
- `package.json`, `package-lock.json`: Dexie, test yardımcısı ve `npm test`.

### Invariants

- `src/main.js` ve çalışan `stopwatchStore.js` değiştirilmedi; canlı verinin
  kaynağı hâlâ mevcut `localStorage` store'dur. Yeni repository henüz
  uygulama açılışına veya canlı timer eylemlerine bağlanmaz.
- Eski veriye ait import, backup, marker, pending-classification ve ID
  eşleştirme kodu bulunmaz. Eski geliştirme timer'ları yeni sisteme taşınmaz.
- Gelecekte yeni IndexedDB verileri kullanılmaya başlandıktan sonra yerel
  standalone kayıtlar ve kişisel outbox işlemleri yeniden açılışta korunmalıdır.
- Frontend kapsam denetimi backend yetkisinin yerine geçmez. Auth ve socket
  mekanizmaları ile kullanıcı, workspace ve session kayıtlarına dokunulmadı.
- Mevcut Supabase timer kayıtları silinmedi; SQL sıfırlama gerekmedi.

### Testler

- `npm ci`, `npm test` (5/5), `npm run build`: geçti.
- Patch sağlanan kaynak ZIP'ine ve ek `/timer/cancel` changelog kaydı bulunan
  kopyaya temiz uygulandı; gerçek Git HEAD burada yok, ayrıca doğrulanmalıdır.

### Ertelenenler

- Backend kişisel API/yetkileri, outbox, senkronizasyon, store entegrasyonu,
  standalone ağ engelleri ve shared eylemlerinin sunucu otoritesi sonraki
  fazlardadır. Phase 1 tek başına üretime alınmaz.
- Gelecekte planlı geçişte eski timer verileri terk edilebilir; auth için
  kullanılan `localStorage` anahtarları silinmemelidir.

---

## 2026-09-24 — Auth / Session / Socket hardening tamamlandı

### Durum

Bu faz **kapalı/dondurulmuş** kabul edilir. Yalnızca somut bir production bug'ı, güvenlik açığı, session-isolation ihlali veya veri bozulması bulunursa tekrar açılmalıdır.

Stil, isimlendirme, küçük refactor veya teorik edge-case gerekçesiyle tekrar kurcalanmamalıdır.

### Tamamlanan hedefler

- Access token süresi dolduğunda, refresh session geçerliyse sessiz refresh çalışıyor.
- Eski/stale HTTP cevapları yeni login session'ını değiştiremiyor.
- Eski refresh/logout işlemleri yeni login'i temizleyemiyor.
- Aynı browser profilindeki sekmeler per-tab session identity ile izole.
- Stale tab sonradan açılan başka session'ı sahiplenemiyor.
- Socket immutable session identity'ye bağlı.
- Socket 401 hatası mevcut ortak refresh akışını kullanıyor.
- Socket middleware 503 hataları kontrollü retry kullanıyor.
- 1s / 3s / 7s retry bittikten sonra 30 saniyelik recovery probe devam ediyor.
- Logout, access token geçersiz/expired olsa bile refresh session'ı backend'de revoke ediyor.
- Logout sonrası ilgili login session'ının açık socket'leri server tarafından kesiliyor.
- Superadmin force-logout hedef kullanıcının açık socket'lerini server tarafından kesiyor.
- Başarılı socket reconnect sonrası shared timer reconciliation çalışıyor.

---

## Frontend auth/session mimarisi

### `frontend/src/services/backendSync.js`

Temel yapı:

- `authGeneration`: stale auth işlemlerini geçersiz kılar.
- Refresh, generation + refresh token bazında single-flight.
- Refresh token login-session kimliğinin stabil referansı olarak kullanılır.
- Frontend JWT payload decode işlemi yalnızca identity matching içindir; authorization için kullanılmaz.
- Per-tab binding:
  - `sessionStorage["keeptimer-tab-auth-session"]`
- Browser genelindeki access/refresh/user bilgileri localStorage'da.
- Uygun ortamlarda Web Locks auth mutation'larını sekmeler arasında serialize eder.

Önemli helper'lar:

- `getAuthGeneration()`
- `getAccessToken()`
- `getRefreshToken()`
- `getTokenSessionIdentity(token, expectedType)`
- `getTabSessionIdentity()`
- `isTabSessionCurrent()`
- `refreshAccessToken(...)`
- `clearAuthSessionIfCurrent(...)`

Önemli event'ler:

- `keeptimer:auth-session-changed`
- `keeptimer:auth-local-logout`
- `keeptimer:auth-login-required`
- `keeptimer:auth-access-token-refreshed`

### HTTP 401 / refresh davranışı

`apiFetch()` request'in auth context'ini snapshot olarak alır ve response geldiğinde hâlâ aynı session'a ait olduğunu kontrol eder.

401 durumunda:

1. Aynı session için access token zaten değişmişse yeni token ile bir kez retry eder.
2. Aksi halde `refreshAccessToken(...)` çağrılır.
3. Refresh başarılıysa request yeniden gönderilir.
4. Refresh 401/403 ise hard auth failure.
5. Network/503 refresh failure transient kabul edilir; session temizlenmez.

### Cross-tab davranışı

Onaylanan davranış:

- Aynı browser profilindeki tab'ler localStorage üzerinden tek aktif browser login'i paylaşır.
- Eski session'a bağlı stale tab yeni session'ı sahiplenemez.
- Stale tab reload edilirse eski binding korunur ve login'e düşer.
- Farklı browser/device session'ları bağımsızdır.

---

## Socket authentication ve recovery

### `frontend/src/services/socket.js`

Socket yalnızca kendi oluşturulduğu immutable session identity ile geçerlidir.

Bir socket instance yalnızca şu koşullarda current kabul edilir:

- global current socket odur,
- kayıtlı socket session identity eşleşir,
- tab session identity eşleşir,
- `isTabSessionCurrent()` true'dur.

Timer-event callback'leri ve reconnect callback'leri stale socket instance'larının UI state'ini değiştirmesini engelleyen guard'larla çalışır.

### Socket 401 recovery

Socket middleware 401 verdiğinde:

- reddedilen handshake token kaydedilir,
- daha yeni access token zaten varsa onunla retry edilir,
- yoksa ortak `refreshAccessToken(...)` akışı çağrılır,
- başarılı refresh access-token-refreshed event'i ile reconnect'i tetikler,
- hard refresh failure yalnız hâlâ current olan auth session'ı temizler,
- transient refresh failure session'ı korur ve kontrollü socket retry planlar.

### 503 / transient recovery

Kısa retry gecikmeleri:

- 1 saniye
- 3 saniye
- 7 saniye

Bunlar bittikten sonra:

- connection hâlâ isteniyorsa,
- socket instance hâlâ current ise,
- tab/session hâlâ current ise,

30 saniyede bir düşük frekanslı recovery probe devam eder.

Başarılı connect retry/probe state'ini sıfırlar.

Logout veya session change pending retry timer'larını iptal eder ve eski socket'i geçersiz kılar.

Normal transport/network reconnect davranışı Socket.IO'ya bırakılır.

### Reconnect reconciliation

Socket reconnect sonrası shared timer reconciliation çalışır; kaçırılmış realtime event'ler yüzünden UI'nın stale kalması engellenir.

---

## Backend session/socket lifecycle

### Socket room'ları

Authenticated socket'ler server tarafından şu odalara alınır:

- `user-${user.id}`
- `session-${sessionId}`
- varsa `workspace-${workspaceId}`

Client workspace room seçmez.

### Logout sözleşmesi

Eski `/auth/logout` geçerli access token gerektiriyordu.

Yeni davranış:

- `/auth/logout` refresh token alır.
- Backend şunları doğrular:
  - JWT geçerliliği
  - `type === "refresh"`
  - user id
  - session id
  - DB session
  - refresh token hash eşleşmesi
- Yalnız o session revoke edilir.
- Zaten revoked session için logout idempotent davranır.

Revoke sonrası:

`io.in(\`session-${session.id}\`).disconnectSockets(true)`

ile o login session'ına bağlı açık socket'ler anında kesilir.

### Superadmin force logout

Force-logout hedef kullanıcının tüm aktif session'larını revoke eder.

Ardından:

`io.in(\`user-${id}\`).disconnectSockets(true)`

ile hedef kullanıcının açık socket'leri anında kesilir.

---

## Yapılan testler

### HTTP refresh

Geçti:

- Bozuk access token signature → refresh → aynı session için yeni access → request başarılı.
- Revoked refresh session → hard fail → güvenli local cleanup → login required.
- Refresh network/transient failure → session korunur, false logout olmaz.

### Socket 401 race — iki ordering

Geçti:

- Socket 401 önce, refresh event sonra.
- Refresh event önce, eski socket handshake 401 sonra.

Her iki durumda da doğru session token ile reconnect oldu.

### Socket-only 401

HTTP request olmadan test edildi:

- access signature bozuldu,
- socket reconnect denedi,
- socket 401 aldı,
- socket ortak refresh flow'u tetikledi,
- yeni access token geldi,
- socket reconnect oldu,
- reconciliation tamamlandı.

Geçti.

### 503 bounded retry

Simüle edilen middleware-style 503 state sonrası:

- socket inactive/disconnected,
- kontrollü retry,
- `reconnect: true`,
- shared reconciliation tamamlandı.

Geçti.

### Long-tail recovery probe

1s / 3s / 7s retry'ların tükenmiş olduğu state simüle edildi.

Sonuç:

- 30 saniyelik recovery probe socket'i yeniden bağladı,
- reconciliation tamamlandı,
- kullanıcı login'e atılmadı.

Geçti.

### Expired/invalid access ile logout

Test:

1. Refresh token yedeklendi.
2. Access token signature bozuldu.
3. Session identity aynı kaldı.
4. Normal Logout yapıldı.
5. Yedek eski refresh token ile `/auth/refresh` çağrıldı.

Sonuç:

- UI login ekranına geçti.
- Backend `401` döndürdü:
  - `Oturum sonlandırılmış, tekrar giriş yapın`

Bu, expired/invalid access'e rağmen backend refresh session'ın revoke edildiğini doğruladı.

### Server-side logout socket disconnect

Frontend'in normal local disconnect'i kullanılmadan `/auth/logout` doğrudan çağrıldı.

Sonuç:

- `200 { success: true }`
- socket reason: `io server disconnect`
- final:
  - `connected: false`
  - `active: false`

Geçti.

### Superadmin force-logout socket disconnect

İki ayrı browser context kullanıldı.

- Hedef kullanıcı authenticated socket ile bağlıydı.
- Superadmin force-logout çağırdı.
- Backend 200 döndürdü.
- Hedef kullanıcının socket'i server tarafından disconnect edildi.

Geçti.

---

## Bu fazdaki commit mesajları

Bilinen commit mesajları:

- `fix(auth): harden cross-tab session isolation`
- `fix(auth): harden socket authentication recovery`
- `fix(auth): harden socket recovery and logout revocation`
- `fix(auth): disconnect revoked session sockets`
- `fix(auth): disconnect sockets on force logout`
- `fix(auth): add long-tail socket recovery`

Commit hash'leri bu dosyaya kaydedilmedi.

---

## Kırılmaması gereken invariants

1. Eski auth request yeni login'i temizleyemez veya overwrite edemez.
2. Stale tab başka tab'in yeni login session'ını sahiplenemez.
3. Frontend JWT decode authorization için kullanılmaz.
4. Socket workspace membership server tarafından belirlenir.
5. Socket bir session'dan başka session'a sessizce migrate edemez.
6. Stale socket callback/event current UI state'ini değiştiremez.
7. Shared timer server-authoritative kalır.
8. Normal transport reconnect Socket.IO'ya bırakılır.
9. Logout local-first kalır; backend ulaşılamasa da UI logout gecikmez.
10. Backend session revoke edildiğinde açık socket'ler de kapatılır.

---

## Bilerek ertelenen işler

- Dev/HMR sırasında duplicate top-level listener/log görülebilir; production kritik değil.
- Offline-first timer repository/outbox/sync mimarisi ayrı faz.
- IndexedDB/Dexie planı ayrı faz.
- Telegram scheduler'ın backend restart sonrası persistence konusu ayrı bilinen sınırlama.

---

## Timer data-mode bağlamı

KeepTimer üç modu ayırır:

1. `workspace_id == null`
   - standalone/local-only
   - hedef mimaride fully offline

2. workspace + `is_shared == false`
   - company-owned personal timer
   - local-first + DB sync
   - creator operates

3. workspace + `is_shared == true`
   - company shared timer
   - server/DB authoritative
   - local display cache
   - backend yokken mutation queue edilmez; mutation blocked

Önemli: Mode 1 ve Mode 2 yalnızca `is_shared == false` oldukları için aynı kategoriye indirgenmemelidir.

---

## Bundan sonraki kayıt şablonu

```md
## YYYY-MM-DD — Kısa değişiklik başlığı

### Neden
Değişikliğe yol açan problem veya gereksinim.

### Değişenler
- Dosya/path
- Davranış değişikliği
- Önemli implementation detayı

### Invariants
Gelecekte korunması gereken kurallar.

### Testler
- Yapılan test
- Beklenen sonuç
- Gerçek sonuç

### Commit
`type(scope): message`

### Ertelenenler
Bilerek sonraya bırakılan işler.
```

---

## 2026-09-24 — Timer notification cancel authorization hardened

### Neden

`POST /timer/cancel` endpoint'i yalnızca authenticated olmayı kontrol ediyor, gönderilen `timerId` üzerinde kullanıcının yetkisi olup olmadığını doğrulamadan scheduler kaydını iptal ediyordu.

Bu nedenle authenticated bir kullanıcı başka bir kullanıcının personal timer'ına ait notification scheduler'ını `timerId` bilgisini biliyorsa iptal edebiliyordu.

### Değişenler

- `backend/src/server.js`
- `POST /timer/cancel` artık timer kaydını DB'den okuyor.
- Yalnız `record_status = active` timer kabul ediliyor.
- Yetki kuralı `/timer/start` ile aynı hale getirildi:
  - `superadmin`: izinli
  - shared timer: kullanıcının aynı workspace'te olması gerekli
  - personal timer: yalnız timer sahibi izinli
- Yetki doğrulanmadan `cancelTimer(timerId)` çağrılmıyor.
- Timer bulunamazsa `404`, DB okuma problemi varsa `500`, yetki yoksa `403` dönüyor.

### Invariants

- Authentication tek başına bir timer üzerinde işlem yetkisi anlamına gelmez.
- Notification start/cancel işlemleri timer CRUD authorization kurallarıyla uyumlu kalmalıdır.
- Shared timer işlemlerinde workspace sınırı korunmalıdır.
- Personal timer işlemlerinde sahiplik korunmalıdır.

### Testler

1. Kullanıcı A'ya ait `isShared: false` personal timer ID'si alındı.
2. Farklı browser context'te Kullanıcı B ile `POST /timer/cancel` çağrıldı.
3. Sonuç:
   - HTTP `403`
   - `Bu timer için bildirimi iptal etme yetkiniz yok`
4. Aynı timer için Kullanıcı A kendi access token'ı ile `POST /timer/cancel` çağırdı.
5. Sonuç:
   - HTTP `200`
   - `{ success: true }`

Her iki test geçti.

### Commit

`fix(timer): authorize notification cancellation`

### Ertelenenler

Timer offline-first / IndexedDB / repository / outbox / sync-engine mimarisi ayrı faz olarak ele alınacak.

---

## 2026-09-26 — Phase 3: kalıcı kişisel outbox ve bağımsız sync motoru

### Neden

Phase 1 yerel repository ve Phase 2 kişisel API üzerine, UI'ya bağlanmadan
atomik ve kalıcı kişisel senkronizasyon altyapısı eklemek.

### Değişenler

- `src/data/timerDb.js`: v1 korunarak v2 `personalOutbox` tablosu.
- `src/data/timerRepository.js`: sync metadata korunması, silinen kişisel
  kayıtların normal okumalardan çıkarılması ve yeniden oluşturma engeli.
- `src/sync/personalSyncModel.js`, `personalOutbox.js`, `personalSyncApi.js`,
  `personalSyncEngine.js`: açık canonical dönüşüm, atomik işlemler, kalıcı
  request body/revision/mutationId, Web Locks ile sıralı flush/pull.
- `src/services/backendSync.js`: BASE_URL export ve isteğe bağlı scope guard.
  Auth kilidi/refresh beklenirken değişen workspace'in eski kişisel isteği
  göndermemesi gerçek apiFetch testleriyle doğrulandı; legacy çağrılar korunur.
- Üç yeni test dosyası ve `src/sync/testSupport/fixtures.js`.
- `docs/PHASE3_PERSONAL_SYNC.md`: mimari, testler, sınırlar ve Phase 4 sözleşmesi.

### Invariants

- Yalnız workspace-personal işlemler outbox'a girer; kullanıcı/workspace
  kapsamı sabittir. Standalone/shared dışarıda kalır.
- Bilinmeyen sunucu sonucunda aynı JSON body, mutationId ve revision tekrar
  kullanılır. Önceki işlem çözülmeden aynı timer'ın sonraki işlemi gönderilmez.
- 409/404 conflict kalıcıdır; GET'te yokluk create/ack sayılmaz. Yerel
  değişiklikler ve diğer hesapların kuyrukları korunur.
- Local update/outbox ve server ack/local revision transaction'ları atomiktir.
- UI/store/main/socket entegrasyonu yapılmadı; backend/SQL değişmedi.

### Testler

- Mevcut 8 test korunarak `npm test`: 80 başarılı, 0 başarısız, 0 atlanan.
- Dexie v1→v2, yeniden açma, create/update/delete rollback, auth/workspace
  geçişleri, iki engine kilidi, kayıp cevap/timeout, revision sırası,
  gerçek apiFetch refresh ve HTTP hata senaryoları doğrulandı.
- İlk normal build, ortamın boş CPU listesi nedeniyle PWA terser adımında
  başarısız oldu. Proje değiştirilmeden yalnız test sürecine tek CPU fallback
  sağlayan preload ile Vite ve PWA service worker üretimi başarılı oldu.
- Patch temiz ZIP kopyasına uygulanıp dosya içerikleri doğrulandı.

### Commit ve sınırlar

Commit, push, merge, canlı SQL veya deploy yapılmadı. ZIP'ten gerçek commit
kimliği doğrulanamaz. Phase 2'nin yayın durumu için görev metni eski changelog
kaydından üstündür; bu tur canlı doğrulama yapılmadı.

Web Locks olmayan ortamda flush/pull güvenli biçimde `unsupported-locks`
döndürür; yerel kuyruk korunur. Gerçek tarayıcı/Capacitor cihaz testi yapılmadı.
Conflict çözüm UI'ı, background scheduler, store entegrasyonu ve Phase 4–6
bilerek eklenmedi.


---

## 2026-09-27 — Phase 3 kod incelemesi, düzeltmeler ve yerel doğrulama

### Neden

Astra tarafından hazırlanan Phase 3 kodları ek incelemelerden
geçirildi. UUID biçimi, sayaç ismi uzunluğu, cihazlar arası
silme uzlaştırması ve mevcut backend sözleşmesi değerlendirildi.

Amaç, altı aşamalı ana mimari planın dışına çıkmadan Phase 3
kodlarını sadeleştirmek ve yerel ortamda doğrulamaktı.

### Yapılan değişiklikler

- `src/sync/personalSyncModel.js`:
  UUID doğrulaması yalnızca kanonik küçük harfli UUID kabul
  edecek şekilde düzenlendi. Geçerli UUID sürümleri gereksiz
  yere yalnızca v4 ile sınırlandırılmadı.

- Kişisel sayaç isimlerine en fazla 35 karakter sınırı
  getirildi. İlgili doğrulama testleri eklendi.

- Önceki inceleme sürümünde eklenen `syncHidden` ile otomatik
  gizleme yaklaşımı kaldırıldı.

  Mevcut GET endpoint'inin eksiksiz kayıt döndürdüğü
  garanti edilmeden, sunucu listesindeki yokluk nedeniyle
  yerel sayaçların otomatik gizlenmesi doğru bulunmadı.

- Kalıcı outbox, atomik IndexedDB işlemleri, değişmez
  mutationId, revizyon yönetimi ve kullanıcı/workspace
  izolasyonu korundu.

- Web Locks, mevcut auth sistemi ve backend değiştirilmedi.

### Korunan mimari kurallar

- Standalone sayaçlar yalnızca IndexedDB'de tutulur.
- Yalnız workspace-personal işlemler outbox'a alınır.
- Shared sayaçlar Phase 3 outbox'ına alınmaz.
- Bekleyen kişisel değişiklikler ve tombstone kayıtları
  sunucudan gelen eksik liste nedeniyle silinmez.
- Belirsiz sonuçlarda aynı mutationId ve değişmez HTTP
  isteği yeniden kullanılır.
- Eski localStorage sayaçları için migrasyon yapılmaz.
- Yeni IndexedDB verilerinin kalıcılığı korunur.

### Yerel doğrulama

Kullanıcının kendi Windows/frontend geliştirme ortamında:

- `git apply --check`: başarılı.
- Düzeltilmiş Phase 3 patch'i başarıyla uygulandı.
- `npm test`: 83 test, 83 başarılı, 0 başarısız.
- `npm run build`: başarılı.

Önceki 80 başarılı test sonucu ilk teslimata aittir.
83 başarılı test sonucu gözden geçirilmiş sürümün
yerel ortamda çalıştırılmasıyla elde edilmiştir.

### Değişiklik kapsamı

- Frontend Phase 3 kodları yerel geliştirme dalına uygulandı.
- Mevcut UI/store entegrasyonu değiştirilmedi.
- Backend veya Supabase üzerinde yeni işlem yapılmadı.
- Canlı deploy gerçekleştirilmedi.

### Bilerek ertelenenler

- Phase 4: Mevcut stopwatchStore ile local-first entegrasyonu.
- Kişisel sayaç oluşturma, güncelleme ve silme işlemlerinin
  yalnızca outbox üzerinden yürütülmesinin sağlanması.
- Diğer cihazlarda silinen kişisel sayaçların eksiksiz
  sunucu listesi garantisiyle uzlaştırılması.
- Gerçek Android APK üzerinde Web Locks uyumluluk testi.
- Gerçek cihazda offline/reconnect ve çoklu oturum testleri.
- Phase 5 shared mutasyon entegrasyonu.
- Phase 6 kapsamlı uzlaştırma testleri.

### Git durumu

Phase 3 değişiklikleri yerel geliştirme dalına uygulanmıştır.
Commit ve push işlemleri henüz gerçekleştirilmemiştir.

---

## 2026-09-27 — Phase 4: store/UI ve kalıcı offline akış

- Pinia store IndexedDB repository/outbox controller'ına bağlandı. Standalone timer/Telegram IO yok; kişisel tüm eylemler atomik enqueue, shared mevcut CRUD/socket yolunda. LocalStorage timer watch/import kaldırıldı; auth korunur.
- Başlangıç, scope, online ve foreground sync; geciken cevap/session izolasyonu; aynı UUID import ve açık silme/arşiv sayfalaması eklendi. Minimal backend patch'i gereklidir.
- Count-Up hedef bildirimi ve devam, Countdown doğru deadline, async UI hata/başarı akışı, standalone girişsiz erişim ve offline PWA navigation bağlandı.
- Android minWebViewVersion 107 açıklandı; güvenli Web Locks fallback'i uydurulmadı. Gerçek cihaz testi yapılmadı.
- `npm test`: 114/114; mevcut 83 korunur. Standart build PWA worker'da ortamın sıfır CPU sonucu nedeniyle durdu; yalnız doğrulama preload'u ile Vite/PWA build başarılı. Preload patch'te yoktur.
- Tüm değişen/eklenen dosyalar, gerekçeler ve gerçek cihaz kabul adımları `docs/PHASE4_STORE_INTEGRATION.md` içindedir. Phase 5 shared authority ve Phase 6 kabul matrisi ertelendi. Commit/push/merge/SQL/deploy yapılmadı.

### 2026-09-27 — Shared fix ve DELETE addendum birleşimi

- Phase 4 frontend patch birleşimine shared bildirim teslim işareti ile cache/GET silme yarışı düzeltmeleri eklendi.
- Astra, 114 temel + 8 shared fix + 5 shared delete regresyon testi = 127 başarılı sonuç bildirdi.
- 127 test, standart build ve APK uyumluluğu kullanıcının gerçek frontend ortamında ayrıca doğrulanmalıdır.

## 2026-09-27 — Phase 4 son inceleme: kapsam yarışı ve ek kalıcılık düzeltmeleri

- Silinen shared kayıt, geciken PATCH cevabıyla tekrar yayımlanmaz.
- Başarılı shared POST'un doğrulanmış sonucu cache'e yazılır; GET hatasında görünüm/bildirim sürekliliği korunur. Başka kimlik/sahip/workspace cevabı reddedilir.
- Ondalıklı dakika sürelerinin kişisel senkronizasyon dönüşümü tam milisaniyeye sabitlenir; senkronizasyon sonrası düzenlenebilirlik korunur.
- Profile/Manager workspace cevapları JSON okunduktan sonra özgün oturum/kapsamla doğrulanır. Auth protokolü ve backend değiştirilmedi.
- 4 yeni controller regresyonu önce başarısız, düzeltme sonrası başarılı; 5 yeni workspace oturum testi eklendi. Frontend: **136/136**. Backend: **35 başarılı, 7 atlanan, 0 başarısız**.
- Standart build bu ortamın boş CPU bilgisi yüzünden PWA işçisinde başarısız; yalnız ortam preload'u ile build/PWA başarılı (19 precache girdisi). Preload patch'e dahil değil.
- Kaynak kimlikleri, dosyalar, uygulama talimatı, test sınırları ve 8/10 değerlendirme: `docs/PHASE4_FINAL_REVIEW.md`.
- Tam frontend patch'i önceki frontend patch'lerinin yerine geçer. Phase 5, canlı SQL, commit/push/deploy yapılmadı.
