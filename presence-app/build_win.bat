@echo off
REM Windows 用ビルドスクリプト
REM 事前に: python -m pip install -r requirements.txt

python -m PyInstaller ^
  --onefile ^
  --windowed ^
  --name IMLPresence ^
  --icon icon.ico ^
  presence_app.py

echo 完了: dist\IMLPresence.exe
pause
