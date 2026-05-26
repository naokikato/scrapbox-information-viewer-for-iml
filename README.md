IML向け Scrapbox 情報可視化 Chrome 拡張機能です

## 機能
IMLプロジェクトを開くと，ページによって次の情報を表示するポップアップウィンドウが表示されます．
- ユーザ別貢献度
- 日誌ヒートマップ（ユーザ別）
- 日誌ヒートマップ（ユーザ一覧）
- ログインユーザ一覧

ページの種類ごとにどの情報が表示されるかは次の通りです．
- 議事録ページ　ユーザ別貢献度＆ログインユーザ一覧
- 日誌ページ　日誌ヒートマップ（ユーザ別）＆ログインユーザ一覧
- 「IML 加藤研究室」「研究日誌」「”年度”を含むページ」：日誌ヒートマップ（ユーザ一覧）＆ログインユーザ一覧
- その他：ログインユーザ一覧

ポップアップウィンドウのUIは次の通りです．
- 二つの情報が表示されるページでは，ポップアップウィンドウ内のタブで切り替えることができます．
- ポップアップウィンドウが邪魔な時は×を押すことでボタン化されます．
- ボタンを押すことでポップアップウィンドウを再表示させることができます．
- ポップアップウィンドウは上部をドラッグすることで移動することができます．

ログイン情報について
- Chromeの拡張機能としてインストールすること，IMLプロジェクトを開いているとログイン状態になります．
- 常駐ソフトウェアをインストールすると，Windows及びMacOSにログインしているとログイン状態になります．

## 拡張機能の使い方
- GitHub のリリースページから ZIP ファイルをダウンロードします
  - https://github.com/naokikato/scrapbox-information-viewer-for-iml/releases/latest
- Chromeで chrome://extensions を開きます
- 「デベロッパーモード」をオンにします
- 「パッケージ化されていない拡張機能を読み込む」で解凍したフォルダを選択します

## 常駐アプリの使い方

### Mac の場合

1. アプリをダウンロード
- GitHub のリリースページからダウンロードします。
  - https://github.com/naokikato/scrapbox-information-viewer-for-iml/releases/latest
    - **M1/M2/M3/M4 Mac** の方 → `IMLPresence_mac.zip`
    - **Intel Mac** の方 → `IMLPresence_mac_intel.zip`

2. アプリをインストール
- ダウンロードした ZIP ファイルをダブルクリックして展開する
- 展開された `IMLPresence.app`（または `IMLPresence_intel.app`）を **Applications（アプリケーション）フォルダ** にコピーする

3. 初回起動
- アプリケーションフォルダから `IMLPresence.app` をダブルクリックして起動する
- 「開発元を確認できません」と表示された場合は、**右クリック → 開く → 開く** を選択する
- 名前入力ダイアログが表示されるので、**Scrapbox のユーザ名** を入力して OK を押す

4. ユーザ名をしたい場合
- アプリを終了させてから，次のコマンドを実行し，アプリを再起動
- rm -rf ~/Library/Application\ Support/IMLPresence

5. アンインストールしたい場合
- 次のコマンドを実行して自動起動を解除
  - launchctl unload ~/Library/LaunchAgents/com.iml.presence.plist
  - rm ~/Library/LaunchAgents/com.iml.presence.plist
- アプリ本体を削除（コマンドで行いたい場合は次のコマンドを実行）
  - rm -rf /Applications/IMLPresence.app
- 設定ファイルを削除
  - rm -rf ~/Library/Application\ Support/IMLPresence


### Windows の場合

1. アプリをダウンロード
- GitHub のリリースページからダウンロードします。
  - https://github.com/naokikato/scrapbox-information-viewer-for-iml/releases/latest
    - `IMLPresence.exe` をダウンロードする

2. 初回起動
- ダウンロードした `IMLPresence.exe` を適当なフォルダ（例: `C:\Users\ユーザー名\IMLPresence\`）に移動する
- `IMLPresence.exe` をダブルクリックして起動する
- 「Windows によって PC が保護されました」と表示された場合は、**詳細情報 → 実行** を選択する
- 名前入力ダイアログが表示されるので、**Scrapbox の表示名**（日本語の氏名）を入力して OK を押す

### 使い方
- 起動すると、メニューバー（Mac）またはタスクトレイ（Windows）にアイコンが表示されます。
- アイコンをクリックするとメニューが表示されます。

| メニュー | 動作 |
|---|---|
| 一時停止 | オンライン通知を停止する（もう一度押すと再開） |
| 30分停止 | 30分後に自動的に再開 |
| 1時間停止 | 1時間後に自動的に再開 |
| 3時間停止 | 3時間後に自動的に再開 |
| 終了 | アプリを終了する |

### アイコンの見方

| アイコン | 状態 |
|---|---|
| 白丸・IML（Mac）/ 緑丸・IML（Windows） | オンライン通知中 |
| グレー丸・IML | 停止中（手動または時間指定） |
| 薄グレー丸・IML | スケジュールにより停止中 |

### 自動停止スケジュール
- 初期設定では **平日の 8:30〜18:00** のみオンライン通知を行います。
- それ以外の時間帯（夜間・土日）は自動的に停止します。
