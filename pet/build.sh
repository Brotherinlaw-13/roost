#!/bin/bash
# Builds RoostPet.app next to this script.
#   ./build.sh            compile the app (frames/ is in the repo)
#   ./build.sh --frames   also re-render the animation frames (needs Google Chrome)
set -euo pipefail
cd "$(dirname "$0")"
APP=RoostPet.app
NODE=$(python3 -c "import os,shutil;print(os.path.realpath(shutil.which('node')))")
ATTN="$(cd .. && pwd)/bin/roost-attention.js"
if [ "${1:-}" = "--frames" ] || [ ! -f frames/segments.json ]; then
  python3 make_ghost.py >/dev/null
  printf 'const SPRITE = %s;\n' "$(cat ghost.json)" > sprite.js
  # Pre-render every Lottie frame to PNG (one headless Chrome pass); the app plays them.
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --force-device-scale-factor=1 \
    --window-size=208,224 --virtual-time-budget=20000 --dump-dom "file://$PWD/frames.html" 2>/dev/null > .frames.dom
  python3 - .frames.dom <<'PYF'
import sys, re, json, base64, html, os
data = json.loads(html.unescape(re.search(r'<pre id="out">(.*?)</pre>', open(sys.argv[1]).read(), re.S).group(1)))
os.makedirs('frames', exist_ok=True)
for f in os.listdir('frames'): os.remove(os.path.join('frames', f))
for i, u in enumerate(data['frames']): open(f'frames/{i:03d}.png', 'wb').write(base64.b64decode(u.split(',', 1)[1]))
json.dump({m['cm']: [m['tm'], m['tm'] + m['dr']] for m in data['markers']}, open('frames/segments.json', 'w'))
PYF
  rm -f .frames.dom
fi
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O main.swift -o "$APP/Contents/MacOS/RoostPet" -framework Cocoa -framework QuartzCore -framework Carbon -framework CoreMediaIO
cp -R frames "$APP/Contents/Resources/"
printf '{"node":"%s","attention":"%s","roost":"roost"}\n' "$NODE" "$ATTN" > "$APP/Contents/Resources/config.json"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Roost Pet</string>
  <key>CFBundleIdentifier</key><string>dev.roost.pet</string>
  <key>CFBundleExecutable</key><string>RoostPet</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Opens your sessions in iTerm.</string>
</dict></plist>
PLIST
codesign -s - --force --deep "$APP" >/dev/null 2>&1
echo "built $(pwd)/$APP"
