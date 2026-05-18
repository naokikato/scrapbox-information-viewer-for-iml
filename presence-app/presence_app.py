"""
IML Presence App
PC 起動中（ログイン中）を Firebase に通知する常駐アプリ
"""
import json
import os
import re
import sys
import time
import threading
import uuid
import platform
import requests
from PIL import Image, ImageDraw
import pystray

# ---- 設定 ----
FIREBASE_URL       = "https://iml-presence-default-rtdb.asia-southeast1.firebasedatabase.app"
SCRAPBOX_PROJECT   = "IML"
HEARTBEAT_INTERVAL = 30   # 秒
APP_NAME           = "IML Presence"

# ---- Firebase キー（content.js と同じロジック） ----
def presence_key(name):
    sanitized = re.sub(r'[.#$\[\]]', '_', name)
    return requests.utils.quote(sanitized, safe='')

# ---- config ファイルのパス ----
def config_dir():
    if platform.system() == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    else:
        base = os.path.expanduser("~/Library/Application Support")
    path = os.path.join(base, "IMLPresence")
    os.makedirs(path, exist_ok=True)
    return path

CONFIG_PATH = os.path.join(config_dir(), "config.json")

# ---- config 読み書き ----
def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return None

def save_config(config):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

# ---- Scrapbox/Firebase からアイコン URL を取得 ----
def fetch_photo(name):
    """Firebase に既存エントリがあればそこから、なければ Scrapbox API から photo を取得"""
    # 1. Firebase から取得（ブラウザ拡張が先に書き込んでいる場合）
    try:
        url = f"{FIREBASE_URL}/presence/{presence_key(name)}.json"
        r = requests.get(url, timeout=10)
        if r.ok:
            data = r.json()
            if isinstance(data, dict) and data.get("photo"):
                return data["photo"]
    except Exception:
        pass

    # 2. Scrapbox プロジェクト API から取得（公開プロジェクトの場合）
    try:
        r = requests.get(
            f"https://scrapbox.io/api/projects/{SCRAPBOX_PROJECT}",
            timeout=10
        )
        if r.ok:
            data = r.json()
            members = data.get("users", data.get("members", []))
            for m in members:
                if m.get("displayName") == name or m.get("name") == name:
                    return m.get("photo") or m.get("photoURL") or ""
    except Exception:
        pass

    return ""

# ---- 初回セットアップ（名前入力） ----
def setup_first_run():
    import tkinter as tk
    from tkinter import simpledialog, messagebox

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)

    name = simpledialog.askstring(
        "IML Presence — 初期設定",
        "Scrapbox の表示名を入力してください：",
        parent=root
    )
    if not name or not name.strip():
        messagebox.showinfo("IML Presence", "名前が入力されなかったため終了します。")
        root.destroy()
        sys.exit(0)

    root.destroy()
    name = name.strip()
    photo = fetch_photo(name)
    config = {"name": name, "photo": photo}
    save_config(config)
    return config

# ---- 自動起動登録 ----
def setup_autostart():
    exe = sys.executable

    if platform.system() == "Windows":
        try:
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0, winreg.KEY_SET_VALUE
            )
            winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, f'"{exe}"')
            winreg.CloseKey(key)
        except Exception:
            pass

    elif platform.system() == "Darwin":
        plist_path = os.path.expanduser(
            "~/Library/LaunchAgents/com.iml.presence.plist"
        )
        plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.iml.presence</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/iml_presence.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/iml_presence.log</string>
</dict>
</plist>"""
        try:
            with open(plist_path, "w") as f:
                f.write(plist)
            os.system(f"launchctl load {plist_path}")
        except Exception:
            pass

# ---- Firebase 送受信 ----
def push_presence(config, paused=False):
    if paused:
        return
    try:
        key = presence_key(config["name"])
        url = f"{FIREBASE_URL}/presence/{key}.json"
        photo = config.get("photo", "")
        if photo:
            # photo が既知 → PUT で全フィールドを書き込む
            payload = {"name": config["name"], "photo": photo, "ts": int(time.time())}
            requests.put(url, json=payload, timeout=10)
        else:
            # photo 未取得 → PATCH で name と ts のみ更新（既存 photo を保持）
            payload = {"name": config["name"], "ts": int(time.time())}
            requests.patch(url, json=payload, timeout=10)
    except Exception:
        pass

def delete_presence(config):
    try:
        key = presence_key(config["name"])
        url = f"{FIREBASE_URL}/presence/{key}.json"
        requests.delete(url, timeout=10)
    except Exception:
        pass

# ---- トレイアイコン画像生成 ----
def make_icon_image(color):
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([4, 4, size - 4, size - 4], fill=color)
    return img

ICON_ONLINE = make_icon_image("#4caf50")
ICON_PAUSED = make_icon_image("#aaaaaa")

# ---- バックグラウンドで photo を更新 ----
def refresh_photo_async(config):
    """起動後にバックグラウンドで photo URL を最新化"""
    def _refresh():
        time.sleep(5)  # 少し待ってから取得
        photo = fetch_photo(config["name"])
        if photo and photo != config.get("photo"):
            config["photo"] = photo
            save_config(config)
    threading.Thread(target=_refresh, daemon=True).start()

# ---- メイン ----
def main():
    config = load_config()
    first_run = config is None
    if first_run:
        config = setup_first_run()

    paused = [False]

    # バックグラウンドで photo を最新化
    refresh_photo_async(config)

    # ---- ハートビートスレッド ----
    def heartbeat():
        while True:
            if not paused[0]:
                push_presence(config)
            time.sleep(HEARTBEAT_INTERVAL)

    t = threading.Thread(target=heartbeat, daemon=True)
    t.start()

    # ---- トレイメニュー ----
    def on_toggle(icon, item):
        paused[0] = not paused[0]
        if paused[0]:
            delete_presence(config)
            icon.icon = ICON_PAUSED
            icon.title = f"{APP_NAME}（一時停止中）"
        else:
            push_presence(config)
            icon.icon = ICON_ONLINE
            icon.title = APP_NAME
        icon.update_menu()

    def on_quit(icon, item):
        delete_presence(config)
        icon.stop()

    def pause_label(item):
        return "再開" if paused[0] else "一時停止"

    menu = pystray.Menu(
        pystray.MenuItem(f"名前: {config['name']}", None, enabled=False),
        pystray.MenuItem(pause_label, on_toggle),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("終了", on_quit),
    )

    icon = pystray.Icon(APP_NAME, ICON_ONLINE, APP_NAME, menu)

    if first_run:
        setup_autostart()

    icon.run()

if __name__ == "__main__":
    main()
