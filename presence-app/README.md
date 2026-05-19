# IML Presence App

PC の電源が入っている間（ログイン中）を Firebase に通知する常駐アプリです。

## 機能

- Mac: メニューバーに常駐
- Windows: タスクトレイに常駐
- ログイン時に自動起動
- Scrapbox の表示名・アイコンを自動取得
- スケジュール機能（設定した時間帯のみオンライン通知）

## ビルド方法

### M3 Mac（Apple Silicon）

```bash
pip3 install -r requirements.txt
bash build_mac.sh
# → dist/IMLPresence.app を /Applications にコピーして起動
```

### Intel Mac

Python 3.11 以上が必要です。  
https://www.python.org/downloads/macos/ から「macOS 64-bit universal2 installer」をインストールしてください。

```bash
python3 -m pip install -r requirements.txt
bash build_mac_intel.sh
# → dist/IMLPresence_intel.app を /Applications にコピーして起動
```

### Windows

```bat
python -m pip install -r requirements.txt
python -m PyInstaller IMLPresence.spec
# → dist\IMLPresence.exe を適当なフォルダに置いて起動
```

> Python は https://www.python.org/downloads/windows/ からインストール。  
> インストール時に「Add python.exe to PATH」にチェックを入れること。

## 初回起動

起動時に Scrapbox の表示名を入力するダイアログが表示されます。  
入力後、ログイン時の自動起動が自動的に登録されます。

## スケジュール設定

`config.json` を直接編集して再起動することで変更できます。

- **Mac**: `~/Library/Application Support/IMLPresence/config.json`
- **Windows**: `%APPDATA%\IMLPresence\config.json`

```json
"schedule": {
  "active_weekdays": [0, 1, 2, 3, 4],
  "active_hours_start": 8.5,
  "active_hours_end": 18.0
}
```

- `active_weekdays`: 0=月、1=火、2=水、3=木、4=金、5=土、6=日
- `active_hours_start` / `active_hours_end`: 24時間制（小数可、例: `8.5` = 8:30）

## アイコンの意味

| アイコン | 状態 |
|---|---|
| 🟢 緑 | オンライン（Firebase に通知中） |
| ⚪ 薄グレー | スケジュール停止中 |
| ⬜ グレー | 手動一時停止中 |
