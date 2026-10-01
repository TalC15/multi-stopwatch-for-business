# KeepTimer — PWA ve Android bildirim/ses iyileştirmeleri

> Bu belge ilk patch kaydıdır. Güncel ses davranışı ve ayarlar için [ikinci patch notlarına](SES_AYARLARI_EK_PATCH.md) bakın.

Tarih: 1 Ekim 2026

## Korunan ana mantık

- Sayaç, duraklatma, ödeme, kişisel/ortak çalışma alanı ve sunucu senkronizasyonu kuralları korunur.
- Geri sayım bitince tamamlanır; kronometre hedefe ulaştıktan sonra çalışmaya devam eder.
- Türkçe “{sayaç adı} bitti ve ödendi/ödenmedi” anonsu korunur.
- Birden fazla biten sayaç **tur bazında sırayla**, her biri beş kez okunur. Aralarda bir saniye beklenir.
- Ortak sayaçların zaman ve durum otoritesi sunucudadır. Bildirim planlamak sunucuya süre dolumu/durum değişikliği yazmaz.
- Telegram ve mevcut kişisel bildirim senkronizasyonu uç noktaları değiştirilmez.

## Tespit edilen ve giderilen sorunlar

| Sorun | Düzenleme |
| --- | --- |
| PWA’da mobil tarayıcıyla uyumsuz `new Notification` tabanlı eklenti yolu | Öncelikle service worker `showNotification`; uygun masaüstünde doğrudan bildirim yedeği |
| Sayfa yüklenirken izin istenmesi | İzin, kullanıcının “Bildirimleri etkinleştir” düğmesiyle istenir; mevcut izin açılışta okunur |
| `voiceschanged` ve 500 ms yedeğinin iki konuşma başlatması | Tek başlangıç kilidi, zaman aşımı ve olay temizliği |
| Silinen/durdurulan sayacın mevcut anonsunun sürmesi | AbortController ile o anki konuşmayı ve ses dosyasını iptal etme |
| Native TTS tamamlanma cevabı gelmezse bütün kuyruğun kilitlenmesi | 15 saniyelik koruma ve `stop()` |
| Kart yaşam döngüsüne bağlı, üst üste binen bağımsız sesler | Veri katmanının bildirimiyle çalışan tek alarm kuyruğu; kart ses izleyicileri kaldırıldı |
| UUID dışı kimliklerin geçersiz Android bildirim ID’si üretmesi | Tam kimlik üzerinden pozitif 32 bit hash; native listede ID çakışması kontrolü |
| Android’de `sound: "default"` değerinin olmayan bir `raw/default` kaynağına işaret etmesi | Var olan iki alarm dosyasıyla yeni, sürümlü Android kanalları |
| Bildirimin yalnızca JavaScript süre dolumunu görünce planlanması | Sayaç çalışırken son tarih native işletim sistemine kaydedilir |
| Planlama devam ederken durdurmanın eski plan tarafından geri alınması | Sıralı native işlemler; durdurma/silme/yeniden başlatma/ad/ödeme değişimlerini uzlaştırma |
| Aynı sürede hem planlı hem anlık native bildirim çıkması | Plan kayıtları ve tamamlanma makbuzlarıyla tekrar önleme |
| Android’in teslim edilmiş bildirim API’sinde özel metadata dönmemesi | Plan makbuzlarını cihazda saklama; açılışta pending kayıtlarıyla karşılaştırma |
| İki PWA sekmesinin yerel sayaca aynı anda alarm vermesi | Alarm kararını IndexedDB işlemi içindeki önceki durumla karşılaştırma; hem up/down regresyon testi |
| Çevrimdışında ilk alarm sesinin önbellekte bulunmaması | Her iki MP3 ve bildirim logosu PWA önbelleğine dahil |
| Native WebView’in PWA service worker tarafından eski web arayüzüne takılması | PWA kaydı yalnızca webde; native uygulamada eski `/sw.js` kaydını kaldırma |

## Ses davranışı

PWA’da her sayacın ilk anonsundan önce tipine uygun mevcut ses dosyası çalar. Anonsların çok gecikmemesi için ön ses en fazla dört saniyedir. Ardından beş tur Türkçe anons gelir. Tekrarlanan aynı olay, devam eden anonsun beş turluk bütçesini sıfırlamaz.

Android’de bildirim izni varsa mevcut radar/dijital ses dosyasını bildirim kanalı çalar; ayrıca aynı MP3 WebView üzerinden çalınmaz. Bildirim izni yoksa açık uygulamanın ses kuyruğu çalışmaya devam eder. Android kanal sesi ve titreşimi cihaz ayarlarına bağlıdır. Native anons, Türkçe TTS motorunun cihazda bulunmasına bağlıdır.

“Anonsları sustur” yalnızca uygulamanın ses kuyruğunu durdurur; sayacı durdurmaz, gelecek alarmları iptal etmez. Android sistem kanalının o anda çalan sesini JavaScript üzerinden durdurma garantisi yoktur. “Sesi dene” tek bir örnek ses ve anons verir; bildirim izni istemez.

## Logo entegrasyonu

Gönderilen `KeepTimer-logomuz.png` görseli değiştirilmeden kullanıldı:

- PWA bildirim simgesi: `public/icons/notification-logo.png`.
- Android renkli büyük bildirim simgesi: `native-resources/android/drawable-nodpi/keeptimer_logo.png` → `largeIcon: "keeptimer_logo"`.
- Android durum çubuğu için beyaz vektör: `native-resources/android/drawable/ic_stat_keeptimer.xml` → `smallIcon: "ic_stat_keeptimer"`.

Android renkli logoyu durum çubuğunda tam renkli göstermez; bu nedenle tam logo büyük simgede, sade tek renk simge durum çubuğunda kullanılır. Bildirimdeki görselin boyutu/konumu üretici ve Android sürümüne göre değişebilir. Bu, büyük resimli banner/BigPicture eki değildir.

## Kullanım ve kurulum

### Web/PWA

```bash
npm ci
npm test
npm run build
npm run preview
```

`dist` klasörünü HTTPS üzerinde servis edin; SPA yollarını `index.html` dosyasına yönlendirin. Proje kök URL `/` altında çalışacak şekilde mevcut davranışı korur. Service worker yalnızca production derlemesinde oluşturulur. Menüdeki **Bildirim ve ses ayarları** oturum açmadan da kullanılabilir; girişli kullanıcılar Ayarlar sayfasından da erişebilir.

İzin için “Bildirimleri etkinleştir” düğmesine basın, ardından “Sesi dene” ile cihazı kontrol edin. Web tarayıcısı sesi kullanıcı etkileşimi olmadan engelleyebilir; ilk dokunma/tuş basımı ses elemanını ve konuşma motorunu hazırlar.

### Android/APK

Orijinal ZIP Android Studio/Gradle projesi içermiyordu. Kaynak teslimi bu yapıyı korur; kalıcı Android kaynakları ve aktarım betiği eklenmiştir. Kendi mevcut Android projeniz varsa onu koruyun.

```bash
npm ci
# Yalnızca android/ klasörünüz yoksa:
npm run build
npx cap add android

# Hem mevcut hem yeni Android projelerinde:
npm run android:sync
npx cap open android
```

`android:sync` web derlemesini oluşturur, logo/simge/sesleri aktarır, manifest izinlerini eksikse ekler ve Capacitor sync çalıştırır. Betik tekrar çalıştırılabilir; mevcut manifesti ve diğer Android kaynaklarını korur. Eklenen izinler: `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`. Capacitor eklentisinin kendi manifesti yeniden başlatma alıcısını sağlar.

Kanallar: `keeptimer-radar-v2` ve `keeptimer-digital-v2`. Kanal sesi Android’de oluşturulduktan sonra uygulama tarafından güvenilir şekilde değiştirilemediği için hatalı eski kanalı değiştirmek yerine yeni ID’ler kullanıldı. Kullanıcı bu kanalların ses, titreşim ve görünürlüğünü cihaz ayarlarından değiştirebilir. Ekran kilidinde ödeme/ad detaylarını gizlemek için kanal görünürlüğü private seçildi; son davranış cihaz ayarlarına bağlıdır.

Android 12+ kesin zamanlı alarm erişimi ayrıca kontrol edilir. Kullanıcı ilgili düğmeden sistem ayarını açar. İzin değişince gelecek planlar yeniden kurulur. Kilit dosyasındaki Local Notifications sürümü **8.2.0** ile doğrulandı; `npm ci` kullanın. 8.3+ sürümünün otomatik kesin alarm isteme davranışı için `isExactNotification` alanı da mevcut izinle sınırlandı.

## Gerçek platform sınırları

- **PWA kapalıyken güvenilir zamanlı alarm sağlanamaz.** Service worker sürekli çalışan sayaç değildir. İşletim sistemi sayfayı uyutabilir; kapanmış PWA’da garantili uyarı için sunucu Web Push entegrasyonu gerekir. Bu pakette böyle bir backend oluşturulmadı.
- Android planlı bildirim JavaScript’in her 100 ms’de çalışmasına ihtiyaç duymaz. Ancak Doze, bildirim/kanal izni, kesin alarm erişimi, üretici pil kısıtları ve zorla durdurma sonucu etkiler. `allowWhileIdle` sınırsız sıklık sağlamaz; Android art arda çok yakın alarm teslimlerini sınırlandırabilir.
- Beş turluk TTS arka planda sürekli çalışma garantisi değildir. Native arka plan uyarısı planlı bildirim ve kanal sesidir; kesintisiz arka plan konuşması için ayrıca Android foreground service gerekir.
- Ortak sayaçlar cihazın **son doğrulanmış sunucu durumuna** göre planlanır. Uygulama kapalı/bağlantısızken başka cihazdaki durdurma, silme veya ödeme değişikliği bu cihaza ulaşmayabilir. Yeniden bağlantıda planlar uzlaştırılır. Kapalı uygulamaya anlık ortak durum aktarımı backend push/native hizmet gerektirir.
- Telegram ve cihaz yerel bildirimi ayrı kanallardır; ikisi etkinse ikisinden de uyarı gelmesi mümkündür.

## Doğrulama

- Mevcut 258 test ve ek bildirim/ses regresyon testleri çalıştırıldı; son toplam ve sonuç için `docs/TEST_SONUCLARI.txt` dosyasına bakın.
- Production Vite ve Workbox derlemesi tamamlandı. Önbellekte iki MP3, logo ve özel bildirim tıklama betiği doğrulandı.
- Geçici Android projesi `cap add android` ile oluşturuldu; hazırlık betiği iki kez çalıştırıldı ve `cap sync android` başarılı oldu. Native logo/ses dosyalarının kopyaları ve manifest izinleri kontrol edildi.
- Gerçek Android cihaz/emülatör üzerinde APK derleme, yükleme, arka plan/Doze testi ve sesli dinleme yapılmadı. Bu teslim imzalı APK içermez.
- Etkileşimli tarayıcı kontrolü için Chromium indirmesi başarısız olduğundan görsel/tarayıcı E2E kontrolü tamamlanamadı. Web bildirim adapteri service worker ve masaüstü senaryolarında mock tabanlı test edildi.
- Çalışma ortamı `os.cpus()` için boş liste döndürdüğünden Workbox/Terser’ın worker havuzu ilk denemede başlayamadı. Aynı production derlemesi, yalnızca doğrulama sürecinde tek CPU bilgisi sağlanarak ve yazılabilir geçici dizinle tamamlandı. Proje bağımlılıklarına ya da Terser kaynaklarına yama yapılmadı.

### Cihazda sürüm öncesi kontrol

1. İzin açık/kapalı durumlarında uygulamayı başlatın; kendiliğinden izin penceresi açılmamalı.
2. Geri sayım ve kronometreyi aynı anda bitirin; her sayaç beş tur sıralı okunmalı.
3. Anons sırasında silin/durdurun; ilgili anons kesilmeli, diğer sayaç devam etmeli.
4. Süre dolmadan durdurun, devam ettirin, ad/ödeme bilgisini değiştirin; plan eski haliyle kalmamalı.
5. Android’de ekran kilitliyken alarmı, logoyu ve iki kanal sesini kontrol edin; kesin izin kapalı/açık olarak deneyin.
6. Native bildirime dokunun; uygulama açılmalı ve açık anonsu susturmalı. PWA bildirimi açık uygulamaya odaklanmalı.
7. Uygulamayı yeniden açın; daha önce bildirilen süre için ikinci sistem bildirimi çıkmamalı.
8. İki PWA sekmesinde aynı sayacı bitirin; tek sekme anons vermeli.
9. PWA’yı bir kez çevrimiçi açıp önbellek kurulunca çevrimdışı yeniden açın; iki alarm sesi de erişilebilir olmalı.
10. Başka cihazdan ortak sayacı değiştirin; bu cihaz çevrimiçiyken planın güncellendiğini, çevrimdışıyken son bilinen durum sınırını kontrol edin.

## Kaynaklar

- Capacitor Local Notifications: https://capacitorjs.com/docs/apis/local-notifications
- MDN showNotification: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
- MDN notificationclick: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event

Kurulu 8.2.0 eklentisinin Android kaynakları da kanal sesi, drawable kaynak adı, zamanlama ve teslim edilmiş bildirim metadata davranışı için incelendi.
