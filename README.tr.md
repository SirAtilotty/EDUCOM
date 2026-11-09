# EDUCOM

[English](README.md) · **Türkçe**

Okul içi iletişim ve öğrenme uygulaması (TÜBİTAK 4006 prototipi). ATICOM mesajlaşma altyapısı üzerine kurulmuştur. Tarayıcıda çalışır, telefona uygulama gibi kurulur. Sunucu yalnızca Node.js (22.13 veya üstü) ister, başka bağımlılığı yoktur.

## Özellikler

- **Sınıf grupları:** Her sınıfın bir grubu vardır. Gruba yalnızca o sınıfın öğretmenleri yazar, öğrenciler okur.
- **Ödev takibi:** Öğretmen kendi sınıfına ödev ve teslim tarihi girer. Sınıftaki öğrenciler ödevleri kalan gün sayısıyla görür. İstenirse ödev sınıf grubunda da duyurulur.
- **Yazılıya hazırlık:** Öğrenci kendi sınıf seviyesinde önce dersi, sonra üniteyi seçer ve o ünitenin sorularını çözer; her cevaptan sonra açıklamayı görür. Üniteler MEB'in 2026-2027 çerçeve yıllık planlarındaki sırayla gelir (9-11. sınıf Türkiye Yüzyılı Maarif Modeli, 12. sınıf mevcut program). 9. sınıfta 38 ünitenin her birinde en az 20 soru (toplam 763), 10, 11 ve 12. sınıflarda her derste en az 70 soru (10. sınıfta 560, 11. sınıfta 562, 12. sınıfta 560) vardır. Toplam 2445 soru. Öğretmenler istedikleri üniteye çoktan seçmeli ya da açık uçlu soru ekleyebilir.
- **Gelişim notu:** Öğretmen, kendi sınıfındaki bir öğrenciye gidişatı hakkında not ve genel durum (çok iyi, iyi, orta, geliştirilmeli) gönderir. Notu yalnızca o öğrenci görür.
- **Sohbet:** Özel ve grup sohbetleri, fotoğraf, sesli mesaj, yanıtlama, okundu bilgisi, "yazıyor…" göstergesi, telefon bildirimi. Öğrenciler birbirine yazamaz, yalnızca öğretmenlere yazabilir. Öğretmenin kurduğu grupta birden fazla öğrenci varsa öğrenciler sadece okur.
- **Görünüm:** Açık, koyu ya da sistem teması; altı renk; sohbet arka planı (okul amblemi, kareli, çizgili, noktalı ya da kendi fotoğrafın); yazı boyutu. Bu ayarlar her telefonda ayrı saklanır.
- Türkçe ve İngilizce arayüz.

## Roller ve kayıt kodları

Okula kayıt kodlarını yönetici (sunucuyu çalıştıran kişi) üretir. **Öğretmen kodları O harfiyle başlar.** Bu kodla kayıt olan kişi öğretmen sayılır, diğerleri öğrencidir. Kod, kişiyi doğrudan sınıfına ve sınıf grubuna ekler. Sınıf, ilk kodu üretildiğinde kendiliğinden açılır.

```sh
node server.js invite student 9-A 30        # 9-A için 30 öğrenci kodu
node server.js invite teacher 9-A 10-B      # 9-A ve 10-B'ye giren bir öğretmenin kodu
node server.js classes                      # sınıflar ve kişi sayıları
node server.js reset <kullanıcı>            # geçici şifre verir, açık oturumları kapatır
node server.js remove <kullanıcı>           # üyeyi çıkarır, eski mesajları kalır
node server.js backup <klasör>              # veritabanı ve dosyaların yedeği
```

Kodlar tek kullanımlıktır, 7 gün geçerlidir ve `ABCDE-FGHJK` biçiminde yazdırılır. Öğrenci kodu elle yazabilir ya da yanındaki linke dokunabilir. Kodda karışabilecek harfler (O/0, I/1, L) kullanılmaz.

## Çalıştırma

```sh
npm start        # http://localhost:3001
npm test
```

Sunucuda `BASE_URL=https://adresin` ayarla ki kodların yanındaki linkler doğru adresi göstersin. Diğer ayarlar: `PORT` (3001), `HOST` (127.0.0.1), `DATA_DIR`.

## Veriler

Her şey `data/` klasöründedir: veritabanı, fotoğraflar, sesli mesajlar ve bildirim anahtarı. Bu klasör git'e girmez; kimseyle paylaşma. Hazır soru bankası `questions/` klasöründedir: her sınıf ve ders için bir dosya (`9-matematik.json` gibi), içinde ünite adı, konuları ve sorular. Üniteler ve konular MEB'in tymm.meb.gov.tr adresinde yayımladığı 2026-2027 taslak çerçeve yıllık planlarından (Anadolu Lisesi) alınmıştır.

## Raspberry Pi'de çalıştırma

EDUCOM 3001 portunu kullanır, bu yüzden aynı Pi'deki başka servislerle karışmaz. Aşağıdaki adımlarda kullanıcı `pi`, klasör `/home/pi/EDUCOM`; seninkiler farklıysa değiştir.

1. Projeyi Pi'ye kopyala (aşağıdaki "Güncelleme" komutuyla).

2. Tailscale ile 8443 portunda bir HTTPS adresi aç:

   ```sh
   sudo tailscale funnel --bg --https=8443 3001
   ```

   Adres `https://<pi>.<tailnet>.ts.net:8443` olur.

3. `/etc/systemd/system/educom.service` dosyasını oluştur:

   ```ini
   [Unit]
   Description=EDUCOM
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=pi
   WorkingDirectory=/home/pi/EDUCOM
   Environment=PORT=3001
   Environment=BASE_URL=https://SENIN-PI.ts.net:8443
   ExecStart=/usr/bin/node server.js
   Restart=always
   NoNewPrivileges=true

   [Install]
   WantedBy=multi-user.target
   ```

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now educom
   ```

4. Kodları üret:

   ```sh
   cd /home/pi/EDUCOM && BASE_URL=https://SENIN-PI.ts.net:8443 node server.js invite teacher 9-A
   ```

## Güncelleme

Önce bilgisayarında `npm test` çalıştır. Sonra kodu Pi'ye gönder ve servisi yeniden başlat. `data/` gönderilmez, yani mesajlar ve hesaplar yerinde kalır.

```sh
tar --exclude=data --exclude=.git -czf - -C ~/Desktop EDUCOM | ssh pi@PI-ADRESI 'tar -xzf -' && ssh -t pi@PI-ADRESI 'sudo systemctl restart educom'
```

Telefonlar yeni sürümü uygulama kapatılıp açılınca alır.
