# خروجی اندروید (Capacitor)

## ساخت
1. `bun add @capacitor/core @capacitor/android && bun add -d @capacitor/cli`
2. خروجی استاتیک بسازید (حالت SPA در TanStack Start: `tanstackStart: { spa: { enabled: true } }` در `vite.config.ts`)، سپس `bun run build`.
3. `bunx cap add android` و بعد `bunx cap sync android`
4. در `android/app/src/main/AndroidManifest.xml` این مجوزها را اضافه کنید:
   ```xml
   <uses-permission android:name="android.permission.RECORD_AUDIO" />
   <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
   <uses-permission android:name="android.permission.VIBRATE" />
   ```
5. `bunx cap open android` و اجرا از Android Studio.

`capacitor.config.json` با `androidScheme: "http"` و `cleartext` تنظیم شده تا اتصال `ws://` در شبکه محلی مسدود نشود.

## ارتباط در شبکه محلی
- یک دستگاه هات‌اسپات می‌سازد؛ بقیه به آن وصل می‌شوند (اینترنت لازم نیست).
- روی یکی از دستگاه‌ها (لپ‌تاپ، یا گوشی اندروید با Termux) پوشه `relay` را اجرا کنید:
  `cd relay && npm install && npm start`
- آدرس چاپ‌شده (مثل `ws://192.168.43.1:8787`) را در برنامه، حالت «وای‌فای محلی»، وارد کنید.

## گام بعدی (اختیاری): بدون میزبان
برای ارتباط مستقیم گوشی‌به‌گوشی بدون میزبان، می‌توان یک ترنسپورت UDP multicast با پلاگین بومی Capacitor
در `src/lib/radio/transport.ts` اضافه کرد؛ پروتکل پیام‌ها (`protocol.ts`) بدون تغییر باقی می‌ماند.
