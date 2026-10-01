# Ses ayarları — ikinci, artımlı patch

Bu patch, **KeepTimer-bildirim-ses.patch uygulanmış kaynak** üzerine hazırlanmıştır. İlk patch'i tekrar uygulamayın. Yeni paket/dependency kurulumu eklenmez.

## İstenen davranışlar

- Alarm, TTS bitmesini beklemeden başlar; TTS'nin beş turu boyunca döngüde çalar. Konuşma başlarken alarm durdurulmaz. Beş tur tamamlanınca ilgili alarm kapanır.
- TTS kapalıysa mevcut alarm dosyası bir kez, doğal süresi boyunca çalar. Alarm kapalıysa yalnızca TTS çalışır. İkisi de kapalıysa görsel bildirim ve sayaç çalışması sürer.
- `/settings` içinde **Hakkında'nın hemen üstünde “Ses ayarları”** bölümü bulunur. TTS/alarm ayrı ayrı açılıp kapatılır; iki ses düzeyi bağımsız ayarlanır. %0 sessiz sayılır.
- Ayarlar bu cihazda saklanır. Sekmeler aynı tercihleri storage olayıyla alır. Sürgü hareketi sırasında ses düzeyi güncellenir; tercih diske sürgü bırakılınca yazılır.
- Kapatma mevcut oynatımı keser. Alarm ses düzeyi anında, TTS ses düzeyi sonraki cümlede uygulanır. Açma tercihleri sonraki uyarılar için kullanılır; bitmiş uyarılar yeniden başlatılmaz.
- “Seçili sesleri dene” açık tercihlerle bir örnek çalıştırır. “Çalan sesleri sustur” uygulamanın mevcut seslerini keser; sayaç durumunu değiştirmez.

## Ödeme değişikliği

Sayaç bittikten sonra adı veya ödeme bilgisi değiştiğinde **kuyruktaki mevcut kayıt** güncellenir. Başlamış cümle kesilmez; sonraki TTS turu güncel “ödendi / ödenmedi” bilgisini okur. Tur sayısı sıfırlanmaz, beş turu bitmiş anons yeniden başlamaz.

Bunun için sunucu isteği, veritabanı sorgusu veya polling eklenmez. Mevcut store değişiminde `Map` kaydı güncellenir. Daha önce teslim edilmiş sistem bildiriminin eski metni yeniden gönderilmez; bu patch'in ödeme düzeltmesi devam eden TTS içindir. Duraklatma sırasında hedefe ulaşmış kronometrede sonradan ödeme değiştirmek artık mevcut anonsu iptal etmez.

## APK / PWA

PWA, uygulamanın kendi alarm sesini kullanır; sistem bildirimi sessiz gönderilerek ses aç/kapat kontrolü korunur. Tarayıcı/işletim sistemi ses politikaları geçerlidir. Kapalı/uyutulmuş PWA'da sürekli alarm garantisi eklenmemiştir.

Android'de uygulama açıkken iki ses uygulama tarafından birlikte oynatılır. Görsel bildirim için sessiz kanal kullanılarak ikinci bir sistem alarmının üst üste binmesi önlenir. Uygulama arka plana geçerken gelecek bildirimler, alarm tercihine göre sesli veya sessiz kanala geçirilir. Görünürlük değişimi dışında periyodik yeniden planlama yapılmaz. İşletim sistemi uygulamayı zorla kapatırsa veya görünürlük geçişini işlemesine fırsat vermezse platformun arka plan kısıtları geçerlidir; bu değişiklik foreground service eklemez.

Android arka plan **ses düzeyi**, işletim sisteminin bildirim kanalı ayarına aittir; uygulamadaki sürgü açık uygulamanın ses düzeyini kontrol eder. Uygulamada alarmı kapatmak veya %0 yapmak gelecek arka plan bildirimlerini de sessiz kanala alır. Kullanıcı Android sistem ayarlarında sessiz kanalın sesini ayrıca değiştirebilir. TTS'yi kapatmak, APK/PWA'daki uygulama anonslarını kapatır; arka planda sürekli TTS garantisi yoktur.

Yeni `keeptimer_silence.wav`, gerçek sessiz PCM kaynağıdır. Capacitor 8.2'de boş ses adı varsayılan sistem sesine dönebildiği için boş dosya adı kullanılmaz. Mevcut logoya ve iki alarm dosyasına dokunulmaz.

## Performans

- Sayaç sayısından bağımsız en fazla **iki** tekrar kullanılan `Audio` nesnesi.
- Aynı tipteki alarmlar aynı oynatıcıyı paylaşır; bir sayacı iptal etmek diğerini susturmaz.
- TTS yine tek sıralı kuyruk; alarmın yaşam süresi konuşma cümlesinden bağımsızdır.
- Alarm katmanı ekranın **100 ms elapsed/remaining** değişimlerini izlemez. Süre dolumunu mevcut controller takip etmeye devam eder.
- Yalnızca gerçek durum/başlangıç/hedef/ödeme/ad ve uygulama görünürlük değişimleri plan uzlaştırır.
- Paylaşılan sayacın son doğrulanmış bitiş tarihi snapshot'ta sabitlenir; ayar veya görünürlük değişimi alarmı ileri kaydırmaz.
- Ses sürgüsündeki pozitif düzey değişiklikleri native bildirim kanallarını yeniden planlamaz. Yalnızca açık/kapalı sınırı geçilirse profil değişir.

## Uygulama

Proje kökünde, ilk patch uygulanmış durumdayken:

```bash
git apply --check KeepTimer-ses-ayarlari-ek.patch
git apply KeepTimer-ses-ayarlari-ek.patch
npm test
npm run build
```

APK için mevcut Android projesinde ayrıca:

```bash
npm run android:sync
```

Bu adım yeni sessiz ses kaynağını Android'e taşır. Ardından APK'yı normal Android Studio/Gradle akışınızla yeniden derleyin. Yalnızca web dosyalarını kopyalamak yeni native kaynağı taşımaz.

## Doğrulama

- **297 test / 297 başarılı**. Önceki 283 test korunur; 14 regresyon testi eklenir.
- Beş tur boyunca eşzamanlı alarm/TTS, canlı ödeme değişikliği, yalnız alarm, ses kapatma/düzey değişikliği, TTS volume, sınırlı oynatıcı sayısı, stale playback, bozuk tercih kaydı, native kanal profili ve sabit ortak son tarih test edilir.
- 100 ekran güncellemesinin alarm watcher'ını çalıştırmadığı; gerçek ödeme değişikliğinin tek güncelleme oluşturduğu test edilir.
- Production Vite/Workbox derlemesi tamamlanmıştır. Ortamın boş CPU listesi için önceki patch'teki geçici build-time uyarlama kullanılmıştır; proje/dependency yaması yoktur.
- Android kaynak hazırlama ve Capacitor sync doğrulanmıştır. Gerçek Android/PWA cihazında işitsel dinleme, kilit ekranı/Doze ve görsel E2E testi yapılmamıştır.

Cihazda özellikle dört kombinasyonu (TTS+alarm / yalnız TTS / yalnız alarm / ikisi kapalı), ödeme değişiminin sonraki cümleye yansımasını ve arka plana geçişte kanal seçimini kontrol edin.
