@echo off
REM Windows 用ビルドスクリプト
REM 事前に: pip install -r requirements.txt

pyinstaller ^
  --onefile ^
  --windowed ^
  --name IMLPresence ^
  presence_app.py

echo 完了: dist\IMLPresence.exe
pause
