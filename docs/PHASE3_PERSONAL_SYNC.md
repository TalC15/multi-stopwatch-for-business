# KeepTimer Phase 3 — kişisel outbox ve Phase 4 sözleşmesi

Tarih: 2026-09-26. Bu kod canlı UI'ya bağlı değildir.

## A. Esas alınan kaynaklar

- Frontend: `KeepTimer_Phase3_Guncel_Frontend.zip`.
  SHA-256: `8a4992a0413d4c5afd2e743a4625f2e92b1489c5d2857ba3d7dc33cc5bc4f95f`.
- Backend: `BACKEND GÜNCEL.zip`.
  SHA-256: `f1ed8acf865e25d42aa311450afe02f5413f84a9b8bc90f5453848a548713d97`.
- İki kaynak CHANGELOG'u ve `Yapıştırılan metin(6).txt` okundu. Çelişkilerde
  görev metni esas alındı. Phase 2'nin dağıtıldığı bilgisi kullanıcı tarafından
  sağlanmıştır; canlı sisteme bağlanıp tekrar doğrulama yapılmadı.
- ZIP'lerde `.git` yoktur. Gerçek dal/commit ve yerel–GitHub farkı doğrulanamaz.
  Kullanıcının bildirdiği hedef dal `feature/offline-phase-1`; backend dalı
  `feature/phase-2-personal-sync`. Kaynak olarak GitHub yerine son yüklenen ZIP
  kullanıldı; yerel yardımcı dosyaların yapılmadığı varsayılmadı.
- İncelenen temel dosyalar: `src/domain/timerDataMode.js`,
  `src/data/timerDb.js`, `src/data/timerRepository.js`, mevcut repository/policy
  testleri, `src/sync/personalSyncPolicy.js`, `src/services/backendSync.js`,
  `src/stores/stopwatchStore.js`, paket dosyaları; backend API belgesi,
  `src/server.js` kişisel endpoint'leri ve kişisel sync SQL migration'ı.

## B. Mimari

Veritabanı adı yine `keeptimer-data`. V1 tanımı korunur. V2 şeması:

```js
{
  timers: "id, dataMode, [userId+workspaceId], workspaceId",
  personalOutbox: "++seq, [userId+workspaceId], timerId"
}
```

Outbox alanları:

| Alan | Anlamı |
| --- | --- |
| `seq` | IndexedDB tarafından verilen kalıcı işlem sırası |
| `timerId`, `userId`, `workspaceId` | Geçerli UUID ve değişmez sahiplik kapsamı |
| `method` | PUT veya DELETE |
| `mutationId` | Kuyruğa eklenirken oluşturulan UUID; retry'da değişmez |
| `expectedRevision` | Başta null; önceki onaydan sonra, ilk gönderimden önce kesinleşir |
| `payload` | PUT için alanları açıkça seçilmiş canonical snapshot; DELETE için null |
| `body` | İlk gönderimden önce kalıcılaştırılan JSON metni; bütün retry'lar aynı metni kullanır |
| `status` | pending, sending, retry, auth-required, forbidden, conflict veya error |
| `attempts`, `retryAt`, `error` | Minimum yeniden deneme bilgisi; token veya sınırsız log tutulmaz |
| `server` | Yalnız conflict incelemesinde son sınırlı kanıt: active, absent-from-active-list veya unavailable |

Yeni kayıt/güncelleme ve outbox ekleme `timers + personalOutbox` üzerindeki tek
Dexie transaction'ıdır. Silme de aynı transaction'da `syncDeleted=true` yapar
ve DELETE kaydı ekler. İkinci yazma başarısızsa ilk yazma geri alınır.

`syncRevision`, `syncState`, `syncDeleted`, `endedAt`, `durationMs` repository
serializer'ında korunur. Onaylanmış revizyon, daha eski UI nesnesinin yeniden
kaydedilmesiyle sıfırlanamaz. Kişisel normal okuma/listeler tombstone'ları gizler.

Başarılı PUT cevabı yerel timer'ın sadece sync metadata'sını günceller; daha
sonra yapılmış yerel değişiklikleri sunucunun eski cevabıyla değiştirmez.
Onay ve outbox silme de atomiktir. DELETE onayı sonrası tam snapshot kaldırılır;
UUID, sahiplik ve son revizyon içeren küçük terminal kayıt tutulur. Bu işaret,
eski yerel nesnelerin silinmiş UUID'yi tekrar oluşturmasını önlemek için kalır.
Yeni bir timer daima yeni UUID alır; otomatik tombstone temizleme eklenmedi.

### Gönderim sırası ve hata davranışı

1. Aktif kullanıcı, workspace, tab-session, refresh kimliği, access-token session
   kimliği ve authGeneration yakalanır.
2. `keeptimer-personal:<userId>:<workspaceId>` adlı Web Lock alınır. Kilit doluysa
   beklemek yerine `busy` döner. Pull aynı kilidi kullanır.
3. Kuyruğun sonlu bir görüntüsü alınır; `seq` sırasıyla işlenir. Aynı timer'ın
   önceki kaydı dururken sonraki kayıt gönderilemez.
4. Revizyon ve tam JSON body transaction içinde kalıcılaştırılır. Ardından
   mevcut `apiFetch` ile gönderilir. Auth kontrolü önemli await sınırlarında,
   DB transaction'larının içinde ve HTTP öncesi/sonrasında tekrar yapılır.
5. UUID, sahiplik, arşiv/silme durumu, revizyon ve PUT canonical durum/mutasyon
   kimliği doğrulanır. PUT tam olarak `expectedRevision + 1` bekler.
6. DELETE için doğrulanmış aynı sahiplikteki, arşivlenmemiş `deleted` kayıt ve
   beklenenden ileri revizyon terminal başarıdır. Phase 2 başka mutasyonla
   zaten silinmiş satırı da döndürebilir; bunun için son mutationId eşitliği
   aranmaz. Eksik veya aktif satır silme onayı olamaz.
7. Onaylanan outbox satırı kaldırılır. Yeni yerel değişiklik flush başladıktan
   sonra geldiyse sonraki açık flush çağrısında işlenir.

| Koşul | Davranış |
| --- | --- |
| 200/201 | İçerik doğrulanır; boş/bozuk cevap onay değildir |
| 400 | Kalıcı `error`; o timer'ın sonraki işlemleri durur |
| 401 | Mevcut apiFetch refresh akışı; hâlâ 401 ise `auth-required` ve flush durur |
| 403 | Kalıcı `forbidden`; bu scope'un gönderimi durur |
| 404/409 | Kalıcı `conflict`; mümkünse GET kanıtı saklanır; diğer timer'lar devam edebilir |
| 429/5xx, network, timeout, beklenmeyen cevap | Aynı body ile yeniden denemek üzere saklanır; o flush durur |
| Session değişimi | Eski sonuç uygulanmaz; kuyruk silinmez; yeni kullanıcıya taşınmaz |
| IndexedDB hatası | Promise reddedilir; UI başarılmış gibi davranmamalıdır |

Retry aralıkları 5, 10, 20, 40, 80, 160 ve en fazla 300 saniyedir.
Her açık flush, uygun bir işleme en fazla bir motor gönderimi yapar. Mevcut
apiFetch'in 401 sonrası tek retry davranışı ayrıca korunur. Polling/background
scheduler yoktur. Timeout 15 saniyedir; fetch abort edilir. Abort sunucuda
rollback garantisi değildir, bu yüzden aynı mutation/body saklanır. Sekme
kapanırsa `sending` kalabilir; `retryAt` geçince yeniden denenebilir.

Conflict otomatik rebase edilmez; server-wins/local-wins seçilmez. GET'te yokluk
"yeni UUID" anlamına gelmez. Tam yerel değişiklikler ve immutable outbox
korunur. Conflict/error/forbidden çözüm ekranı veya manuel çözüm API'si bu
fazda yoktur; Phase 4 bu durumu göstermeli, body/revision'ı yerinde değiştirmemelidir.

### Sekme koordinasyonu ve destek sınırı

Bu sürüm gönderim için `navigator.locks.request` desteğini gerektirir.
Web Locks bulunmayan tarayıcı/WebView'da yerel atomik kayıt çalışır, ancak
flush/pull `unsupported-locks` döner ve ağ isteği atmaz. Güvensiz bellek kilidi
veya süre dolunca iki sekmenin aynı işi sahiplenebileceği bir lease eklenmedi.
Capacitor hedef WebView'ında Web Locks desteği Phase 4 cihaz doğrulamasında
kontrol edilmelidir. Testlerde kilit sözleşmesi iki engine ile deterministik
olarak simüle edildi; gerçek iki tarayıcı sekmesi/cihaz testi yapılmadı.

### Yerel model → sunucu modeli

- `accumulatedTime` zaten milisaniyedir; canonical `accumulatedMs` olur.
  Running durumda gönderim anındaki `elapsed` ile değiştirilmez.
- Running anchor: `endsAt = ISO(startTime + targetMinutes*60000 - accumulatedTime)`.
  Gönderim zamanı bu hesaba girmez; offline geçen süre snapshot'ı değiştirmez.
- `elapsed`, `remaining`, `reachedTarget` görüntüleme alanlarıdır; body'ye girmez.
- Count-Up hedefi geçince `running` kalır; endsAt geçmişte olabilir.
- Countdown yerel `expired` durumu canonical `completed` olur. Tamamlanma
  eylemi gerçek `endedAt` ve `durationMs` sağlamalıdır; bunlar bilinmiyorsa
  kuyruk kontrollü olarak reddeder. Eksik start anchor da reddedilir.
- Sunucudan running kayıt alırken start anchor, endsAt/target/accumulatedMs
  üzerinden yeniden kurulur. Yerel saat geride olsa da endsAt korunur.
- type ve targetMinutes yerel güncellemede değiştirilemez; hedef pozitif olmalıdır.

## C. Dosyalar ve bağımlılıklar

| Dosya | İşlem ve görevi |
| --- | --- |
| `src/data/timerDb.js` | Değişti: v1 korunarak v2 outbox şeması |
| `src/data/timerRepository.js` | Değişti: sync metadata ve tombstone okuma/koruması |
| `src/services/backendSync.js` | Değişti: BASE_URL export ve isteğe bağlı `isRequestCurrent` kapsam kontrolü |
| `src/sync/personalSyncModel.js` | Yeni: UUID/scope, canonical dönüşüm ve server/ack doğrulaması |
| `src/sync/personalOutbox.js` | Yeni: atomik enqueue/delete, kalıcı prepare/ack/error ve güvenli snapshot import |
| `src/sync/personalSyncApi.js` | Yeni: mevcut apiFetch üzerinde personal GET/PUT/DELETE, session guard, timeout |
| `src/sync/personalSyncEngine.js` | Yeni: Web Lock, flush/pull, sıralama ve hata politikası |
| `src/sync/personalOutbox.test.js` | Yeni: yükseltme, kalıcılık, rollback, veri modları ve model testleri |
| `src/sync/personalSyncApi.test.js` | Yeni: gerçek apiFetch üzerinde mock fetch/refresh/scope testleri |
| `src/sync/personalSyncEngine.test.js` | Yeni: sıralama, retry, conflict, izolasyon ve iki engine yarış testleri |
| `src/sync/testSupport/fixtures.js` | Yeni: UUID, deterministik auth/lock ve Phase 2 mock sunucusu |
| `docs/PHASE3_PERSONAL_SYNC.md` | Yeni: bu teslim ve entegrasyon sözleşmesi |
| `docs/KEEP_TIMER_AI_CHANGELOG.md` | Değişti: tarihli Phase 3 kaydı |

Yeni bağımlılık yoktur. Mevcut Dexie, fake-indexeddb ve Node test runner kullanılır.
Mevcut sekiz testin kaynakları, policy, domain, package dosyaları, UI,
main.js, stopwatchStore ve socket.js değişmedi. Backend/SQL patch'i gerekmiyor.

`apiFetch` değişikliğinin somut nedeni: auth kilidi veya refresh await'i
beklenirken kullanıcı nesnesinin workspace'i değişebilir; mevcut session
kontrolü tek başına bu scope değişimini denetlemez. İsteğe bağlı guard ilk
HTTP öncesi ve refresh/yanıt sınırlarında scope'u kontrol eder. Parametre
vermeyen legacy çağrıların davranışı korunur. Yeni auth state machine yoktur.

## D. Doğrulama

- `npm ci --ignore-scripts --no-audit --no-fund`: başarılı.
- Astra orijinal patch için `npm test`: **80 test, 80 başarılı**.
- Bu gözden geçirmede UUID ve isim sınırı testleri eklendi; son tam test
  kullanıcı frontend ortamında tekrar çalıştırılmalıdır.
  Mevcut sekiz test korunur; 72 yeni test vardır.
- İlk genişletilmiş test çalışmasında Node 24'ün salt okunur `navigator.locks`
  özelliğine atama yapan test fixture'ı başarısız oldu. Fixture uygun property
  override ile düzeltildi; üretim beklentisi gevşetilmedi.
- `npm run build`: ilk çalışmada uygulama derlendi; PWA terser worker adımı
  ortamın `os.cpus()` sonucunun boş olması nedeniyle tamamlanamadı.
  Aynı terser çağrısı tek worker ile başarılı oldu. Proje/paket/PWA ayarı
  değiştirilmeden sadece doğrulama sürecinde boş CPU listesine tek worker
  sağlayan Node preload kullanıldı. Bu koşulla **Vite build ve PWA service
  worker üretimi başarılı**. Normal kullanıcı ortamındaki build ayrıca
  aşağıdaki standart komutla çalıştırılmalıdır.
- Patch, sağlanan güncel ZIP'in temiz kopyasına `git apply --check` ve gerçek
  uygulama ile doğrulanır; dosyalar üretilen kaynakla byte düzeyinde karşılaştırılır.
- Canlı Supabase/Render yazma, SQL, commit, push, merge veya deploy yapılmadı.
  Backend testleri tekrar çalıştırılmadı; backend değişmedi.
- Gerçek cihaz, tarayıcı çoklu sekme ve canlı API testi yapılmadı. Bu fazın
  testleri fake IndexedDB ve gerçek istemci auth kodunu kullanan mock HTTP'dir.

## E. Phase 4 entegrasyon sözleşmesi

`scope = { userId, workspaceId }`; ikisi de geçerli UUID'dir. Yerel fonksiyonlara
verilen scope, UI'nin aktif hesabından alınmalıdır; bu parametre tek başına
authentication değildir. Yerel kayıt offline yapılabilir. Ağ erişiminde engine
kendi scope'unu mevcut auth mekanizmasından tekrar yakalar. Aşağıdaki fonksiyonlar
Promise döndürür; yerel DB başarısızlığı kullanıcıya başarı gibi gösterilmemelidir.

| Olay / fonksiyon | Parametre | Başarılı sonuç | Hata ve sorumluluk |
| --- | --- | --- | --- |
| Yeni kişisel timer: `enqueuePersonalPut` | `(timer, scope, { isNew: true })` | `{ timer, seq }` | Yeni crypto.randomUUID gerekir; aynı yerel UUID, yanlış mode/scope, eksik canonical durum reddedilir |
| Kişisel değişiklik: `enqueuePersonalPut` | `(timer, scope)` | `{ timer, seq }` | Bilinen syncRevision gerekir; silinmiş timer ve type/target değişimi reddedilir |
| Kişisel silme: `enqueuePersonalDelete` | `(timerId, scope)` | `{ timerId, seq }` | Yerel timer ve bilinen revision gerekir; atomik tombstone oluşur |
| Kuyruk/durum okuma: `listPersonalOutbox` | `(scope)` | seq sıralı kayıt dizisi | Başka scope kayıtlarını döndürmez; geçersiz scope reddedilir |
| Motor oluşturma: `createPersonalSyncEngine` | Üretimde parametresiz | `{ flush, pull }` | Oluşturma ağ isteği veya otomatik scheduler başlatmaz |
| Gönderim: `engine.flush` | Parametresiz | status, normal işleyişte acknowledged/blocked/deferred | auth-required, session-changed, offline, busy, unsupported-locks, retry, forbidden; DB hataları reject |
| Sunucu okuma: `engine.pull` | Parametresiz | `{ status: "done", imported, preserved }` | Başarısız HTTP/bozuk snapshot reject; auth/offline/lock durumları flush ile aynı |

`status: "done"` kuyruk boş garantisi değildir. `blocked`, `deferred` ve kalıcı
outbox incelenmelidir. `retryAt` gelince Phase 4 uygun bir kullanıcı/bağlantı
olayında yeniden flush çağırabilir; bu faz kendi scheduler'ını kurmaz.

`pull()` mevcut bekleyen, conflict, unbased veya silinmiş yerel kayıtları
korur. Temiz ve daha yeni olmayan sync kaydı güncellenebilir; yeni UUID import
edilebilir. GET listesinde bulunmayan yerel kayıtlar silinmez. GET'ten outbox
onayı çıkarılmaz. Sunucu GET listesi eksiksiz olduğu doğrulanmadıkça uzaktaki
silme/arşivleme nedeniyle toplu gizleme yapılmaz; backend mevcut haliyle
Supabase satır sınırına takılabilir. Phase 4/6'da eksiksiz snapshot veya
sayfalama doğrulanarak diğer cihazdaki silmeler uzlaştırılmalıdır.
Çok cihazlı silme uzlaştırması ve conflict çözümü bu basit
active-only GET sözleşmesiyle otomatik tahmin edilmez.

Alt seviye `importPersonalSnapshot(rows, scope, assertCurrent)` yalnız doğrulanmış
GET cevabı ve güncel session guard ile kullanılmalıdır; normal entegrasyon
`pull()` üzerinden yapılmalıdır. `preparePersonalOperation`,
`acknowledgePersonalOperation`, `markPersonalOperation` engine iç işleridir;
UI bunları doğrudan çağırmamalı, kalıcı body/revision'ı elle değiştirmemelidir.
API factory üretimde mevcut backendSync'i kullanır; dependency injection yalnız
testler içindir. `personalStateFromLocal(timer)` tam snapshot döndürür veya
bilinmeyen/yanlış canonical durumda hata atar; `canEnqueuePersonalTimer` yalnız
ilk uygunluk filtresi olarak aynen korunur.

Hesap/workspace değişiminde kuyruk temizlenmez. Yeni flush/pull yeni session'ı
yakalar; eski async sonuçlar uygulanmaz. Aynı kullanıcı aynı workspace'e yeni
oturumla dönerse kalıcı kuyruğunu uygun retry zamanında tekrar gönderebilir.
Uygulama yeniden açıldığında önce scope belirlenir, yerel repository/outbox
okunur; ardından uygun anda flush/pull açıkça çağrılır.

V1 kişisel kaydının `syncRevision` bilgisi yoksa 0 varsayılmaz. Böyle kayıt
okunabilir kalır, pull tarafından sessizce ezilmez ve sync güncellemesi kontrollü
reddedilir. Phase 4 bu kaydın doğrulanmış başlangıç durumunu belirlemeden onu
"yeni UUID" olarak tekrar göndermemelidir. Eski localStorage için import,
migrasyon, marker veya kurtarma kodu yoktur.

Kişisel create/update/delete eylemlerinde `saveTimer` tek başına kullanılmamalı;
yerel değişiklik yeni outbox fonksiyonlarıyla atomik kaydedilmelidir. Aynı kişisel
UUID için `dbCreateTimer`, `dbUpdateTimer`, `dbDeleteTimer` çağrıları kaldırılmalıdır.
Kişisel timer'ı eski socket/reconciliation akışı ile yeniden yazmak da engellenmelidir.
Standalone yalnız kendi repository fonksiyonlarını kullanır; shared akışı
Phase 5'e kadar bu patch tarafından değiştirilmez. Mevcut UI bugün legacy
akışla çalışmaya devam eder; yeni altyapı kendi kendine çalışmaya başlamaz.

## Patch uygulama

Patch, son yüklenen frontend ZIP'ine göre hazırlanmıştır. Frontend kökünde:

```sh
git apply --check KeepTimer_Phase3.patch
git apply KeepTimer_Phase3.patch
npm ci
npm test
npm run build
```

Başka yerel değişiklikler varsa ilk komutun sonucunu inceleyin; `--reject` veya
zorlayıcı seçeneklerle kısmi uygulama yapmayın. Eski `KeepTimer_Phase1_Clean.patch`
dosyasına dokunulmaz. Bu komutlar commit/push/deploy içermez.
