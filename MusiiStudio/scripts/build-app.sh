#!/bin/bash
# Baut "Musii Studio.app" (Universal: Apple Silicon + Intel, ab macOS 12) und ein DMG.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${VERSION:-1.0.0}"
BUILD="${BUILD:-1}"
APP="build/Musii Studio.app"

echo "==> Kompiliere (arm64 + x86_64, Release)"
swift build -c release --arch arm64 --arch x86_64
BIN_DIR="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)"

echo "==> Erstelle App-Bundle"
rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/MusiiStudio" "$APP/Contents/MacOS/MusiiStudio"
sed -e "s/__VERSION__/$VERSION/g" -e "s/__BUILD__/$BUILD/g" Resources/Info.plist > "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "==> App-Icon"
ICONSET="build/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s Resources/AppIcon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d Resources/AppIcon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "==> Signieren (ad-hoc)"
codesign --force --deep --sign - "$APP"
codesign --verify --verbose "$APP"

echo "==> Prüfe Architekturen und Mindestversion"
lipo -info "$APP/Contents/MacOS/MusiiStudio"
otool -l "$APP/Contents/MacOS/MusiiStudio" | grep -A3 LC_BUILD_VERSION | grep minos | sort -u

echo "==> DMG"
mkdir -p build/dmg
cp -R "$APP" build/dmg/
ln -s /Applications "build/dmg/Programme (Applications)"
cp Resources/Installation.txt "build/dmg/Installation – bitte lesen.txt"
hdiutil create -volname "Musii Studio" -srcfolder build/dmg -ov -format UDZO "build/MusiiStudio.dmg"
(cd build && ditto -c -k --keepParent "Musii Studio.app" "MusiiStudio-App.zip")
ls -lh build/MusiiStudio.dmg build/MusiiStudio-App.zip
echo "==> Fertig"
