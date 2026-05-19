#!/bin/bash
# Mac 用ビルドスクリプト
# 事前に: pip3 install -r requirements.txt

python3 -m PyInstaller \
  -y \
  --onedir \
  --windowed \
  --name IMLPresence \
  --osx-bundle-identifier com.iml.presence \
  --icon icon.icns \
  presence_app.py

# Dock に表示しないよう LSUIElement を Info.plist に追記
PLIST="dist/IMLPresence.app/Contents/Info.plist"
if [ -f "$PLIST" ]; then
  /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$PLIST"
  echo "LSUIElement を設定しました"
fi

echo ""
echo "完了: dist/IMLPresence.app"
echo "dist/IMLPresence.app を /Applications にコピーして起動してください"
