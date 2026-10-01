# Sayaç sıralama — artımlı patch

Bu patch, ilk bildirim patch'i ve ardından `KeepTimer-ses-ayarlari-ek.patch` uygulanmış proje üzerine hazırlanmıştır.

“Sırala” alanı standart HTML `select` kontrolü açar; iki seçenek vardır:

1. **Bitmiş → en yakın → en uzak** (varsayılan)
2. **En uzak → en yakın → bitmiş**

Kronometre, sayaç ve ortak sekmelerinde yalnızca görünür kartlar sıralanır. Seçilen yön aynı sayfa açıkken sekmeler arasında korunur; kalıcı sayaç verisine veya hesap ayarlarına yazılmaz.

## Sıralama kuralları

- Geri sayımda controller'ın ürettiği `remaining` kullanılır.
- Kronometrede hedef süreden controller'ın `elapsed` değeri çıkarılır.
- `completed` / `expired`, hedefe ulaşmış kronometre ve kalan süresi sıfır olan sayaç bitmiş grubuna alınır. Bu yalnızca görünüm sınıflandırmasıdır: sunucu tamamlanma onayı bekleyen ortak sayacın durumu değiştirilmez.
- Duraklatılmış ve henüz başlamamış sayaçlar da kalan hedef süreleriyle karşılaştırılır. Duraklatılmış sayaç için tahmini duvar saati bitişi hesaplanmaz.
- Eşit kalan sürelerde ve bitmiş grubunun içinde kimliğe göre sabit sıra korunur. Ters seçim öncelik gruplarını ve kalan süre sırasını tersine çevirir; eşit değerlerde gereksiz yer değiştirme yapmaz.
- Geçersiz/eksik süre, NaN, Infinity, negatif kalan süre ve tanınmayan durumlar her iki yönde de listenin sonunda tutulur. Kayıt silinmez veya düzeltilmez.
- Ortak sayaçların sunucudan türetilmiş görüntü değerleri kullanılır; sıralama `Date.now()` ile yeni süre üretmez.

## Veri bütünlüğü ve performans

Kaynak diziye `.sort()` uygulanmaz. Yeni sıralama dizisi aynı sayaç nesnelerini ve kart anahtarlarını kullanır; IndexedDB, senkronizasyon, ödeme, alarm, yetki ve toplu başlat/durdur akışları değişmez. Açılır seçenekler sabittir; yalnızca iki izinli değer kabul edilir. Sıralama hiçbir API çağrısı veya sayaç eylemi üretmez. Salt okunur ortak liste de yerel olarak sıralanabilir.

Yeni interval veya ağ isteği eklenmez. Süre ilerlerken önce mevcut sıranın doğruluğu O(n) kontrol edilir; sıra hâlâ doğruysa aynı dizi döndürülür. Kart ekleme/silme, veri yenileme veya gerçekten sıra değişmesi gerektiğinde O(n log n) sıralama yapılır. Zaman birimi milisaniye olarak korunur; yuvarlama nedeniyle eşitlikler arasında gidip gelme oluşturulmaz.

## Uygulama ve doğrulama

```bash
git apply --check KeepTimer-siralama-ek.patch
git apply KeepTimer-siralama-ek.patch
npm test
npm run build
```

APK için normal güncelleme akışında `npm run android:sync` ve yeniden APK derlemesi gerekir. Yeni native bağımlılık veya izin eklenmez.

**312 test başarılı** (önceki 297 + 15 yeni test). Production Vite/Workbox derlemesi başarılıdır. Testler iki yönü, üç liste türünü, gerçek Home seçimini, zamanla yer değiştirmeyi, eşitlikleri, bozuk veriyi, ekleme/silme/yenilemeyi, kaynak verinin değişmemesini ve ortak salt okunur listede hiçbir eylem çağrılmamasını kapsar.

Gerçek cihazda yerel seçim penceresinin görsel/dokunmatik E2E testi yapılmamıştır; Vue bileşen etkileşim testleri çalıştırılmıştır.
