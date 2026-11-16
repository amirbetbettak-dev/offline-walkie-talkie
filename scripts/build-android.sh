#!/usr/bin/env bash
# Builds the offline web bundle and prepares the native Android project (android/).
set -euo pipefail
cd "$(dirname "$0")/.."

CAPACITOR=1 bunx vite build
[ -d android ] || bunx cap add android
bunx cap sync android

JAVA=android/app/src/main/java
mkdir -p "$JAVA/com/bisim/udp" "$JAVA/com/bisim/offline"
cp native/android/BisimUdpPlugin.java "$JAVA/com/bisim/udp/"
cp native/android/MainActivity.java "$JAVA/com/bisim/offline/"

MANIFEST=android/app/src/main/AndroidManifest.xml
PERMS="RECORD_AUDIO MODIFY_AUDIO_SETTINGS INTERNET ACCESS_NETWORK_STATE ACCESS_WIFI_STATE CHANGE_WIFI_STATE CHANGE_WIFI_MULTICAST_STATE ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION NEARBY_WIFI_DEVICES VIBRATE WAKE_LOCK"
for p in $PERMS; do
  grep -q "android.permission.$p\"" "$MANIFEST" || \
    sed -i "s#<application#<uses-permission android:name=\"android.permission.$p\" />\n    <application#" "$MANIFEST"
done
echo "Android project ready. Build the APK with: (cd android && ./gradlew assembleDebug)"
