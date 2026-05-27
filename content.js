// ---- 設定 ----
const AUTO_SHOW_PROJECT  = "IML";
const CONTRIB_KEYWORD    = "議事録";
const DIARY_KEYWORD      = "研究日誌";
const HEATMAP_PAGE_TITLES = ["加藤研究室", "年度"]; // ヒートマップを表示するページのタイトルに含まれる文字列（いずれかにマッチ）
const EXCLUDE_USERS      = ["加藤直樹"];
const LIMIT = 10;
// --------------

// ---- Firebase プレゼンス設定 ----
// Firebase Realtime Database URL（設定するまで機能は無効です）
// 例: "https://your-project-default-rtdb.firebaseio.com"
const FIREBASE_URL = "https://iml-presence-default-rtdb.asia-southeast1.firebasedatabase.app";
const CHAT_PAGE    = "チャット";
const PRESENCE_TTL     = 90;  // 秒：この秒数以上更新がなければオフライン扱い
const NOTIFICATION_TTL = 180; // 秒：3分間通知を表示

let userDismissed  = false;
let _currentShadow = null;
let _currentHost   = null;

// ---- URL 判定 ----
function isWithinProject() {
  const p = location.pathname;
  return p === `/${AUTO_SHOW_PROJECT}` || p.startsWith(`/${AUTO_SHOW_PROJECT}/`);
}
function pageTitle() {
  const m = location.pathname.match(/^\/[^/]+\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : "";
}
function isContribPage()  { return isWithinProject() && pageTitle().includes(CONTRIB_KEYWORD); }
function isDiaryPage()    { return isWithinProject() && pageTitle().includes(DIARY_KEYWORD); }
function isHeatmapPage()  {
  const t = pageTitle();
  return isWithinProject() && (HEATMAP_PAGE_TITLES.some(k => t.includes(k)) || t === "研究日誌");
}
function isPresencePage() { return isWithinProject() && pageTitle() === CHAT_PAGE; }

// ---- データ取得（貢献度） ----
function fetchContributions(pathname = location.pathname) {
  const match = pathname.match(/^\/([^/]+)\/(.+)$/);
  if (!match) return Promise.reject(new Error("Scrapboxのページではありません"));
  const [, project] = match;
  const listPath = `/${AUTO_SHOW_PROJECT}/${encodeURIComponent(STUDENT_LIST_PAGE)}`;
  return Promise.all([
    fetch(`https://scrapbox.io/api/pages${pathname}`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`ページAPI: HTTP ${r.status}`); return r.json(); }),
    fetch(`https://scrapbox.io/api/projects/${project}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null),
    fetch(`https://scrapbox.io/api/pages${listPath}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([pageData, projectData, listData]) => {
    const students = listData ? new Set(parseStudentList(listData.lines)) : null;
    const userNames = {};
    for (const u of (projectData?.users || projectData?.members || [])) {
      if (!u) continue;
      const uid = u.id || u._id;
      if (uid) userNames[uid] = u.displayName || u.name || uid;
    }
    const userLineCount = {};
    for (const line of pageData.lines) {
      if (line.userId) userLineCount[line.userId] = (userLineCount[line.userId] || 0) + 1;
    }
    // ページタイトルが【ユーザ名】… の形式であればそのユーザも除外
    const titleOwnerMatch = pageData.title.match(/^【(.+)】/);
    const titleOwner = titleOwnerMatch ? titleOwnerMatch[1] : null;
    const contributions = Object.entries(userLineCount)
      .map(([uid, count]) => ({ name: userNames[uid] || uid, count }))
      .filter(({ name }) => !EXCLUDE_USERS.includes(name) && name !== titleOwner && (!students || students.has(name)))
      .sort((a, b) => b.count - a.count);
    return { title: pageData.title, totalLines: pageData.lines.length, contributions };
  });
}

// ---- データ取得（日誌） ----
function fetchDiaryData(pathname = location.pathname) {
  return fetch(`https://scrapbox.io/api/pages${pathname}`, { credentials: "include" })
    .then(r => { if (!r.ok) throw new Error(`ページAPI: HTTP ${r.status}`); return r.json(); })
    .then(pageData => ({ title: pageData.title, dateMap: parseDiary(pageData.lines) }));
}

// 文字数カウントから除外する行の先頭パターン
const DIARY_IGNORE_PREFIXES = ["[!*", "[*&"];

// Scrapbox 記法を除去して本文のみを返す
function stripMarkup(text) {
  return text
    .replace(/\[\[(.+?)\]\]/g, "$1")
    .replace(/\[https?:\/\/[^\]\s]+\]/g, "")
    .replace(/\[(.+?)\s+https?:\/\/[^\]]+\]/g, "$1")
    .replace(/\[[*\/\-_^~!&]{1,4}\s(.+?)\]/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function parseDiary(lines) {
  const re = /^\[\[(\d{4})\/(\d{1,2})\/(\d{1,2})\]\]/;
  const dateMap = {};
  let cur = null, chars = 0;
  for (const line of lines) {
    const m = line.text.match(re);
    if (m) {
      if (cur !== null) dateMap[cur] = chars;
      const [, y, mo, d] = m;
      cur = `${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}`;
      chars = 0;
    } else if (cur !== null) {
      const trimmed = line.text.trimStart();
      if (!DIARY_IGNORE_PREFIXES.some(p => trimmed.startsWith(p))) {
        chars += stripMarkup(trimmed).length;
      }
    }
  }
  if (cur !== null) dateMap[cur] = chars;
  return dateMap;
}

// ---- データ取得（ヒートマップ） ----
function parseStudentList(lines) {
  const students = [];
  let inSection = false;
  for (const line of lines) {
    const text = line.text.trimStart();
    if (text.includes("[*** 学生一覧]")) { inSection = true; continue; }
    if (inSection && text.startsWith("（卒業")) break;
    if (inSection && text.trim() !== "") {
      // [名前.icon] を除去してから最初の [名前] または [[名前]] を取得
      const noIcons = text.replace(/\[[^\]]*\.icon\]/g, "");
      const m = noIcons.match(/\[\[?([^\]\[・\s][^\]\[・]*?)\]?\]/);
      if (m && m[1].trim()) students.push(m[1].trim());
    }
  }
  return students;
}

function fetchStudentDiary(studentName) {
  const title = `【${studentName}】研究日誌`;
  const pathname = `/${AUTO_SHOW_PROJECT}/${encodeURIComponent(title)}`;
  return fetch(`https://scrapbox.io/api/pages${pathname}`, { credentials: "include" })
    .then(r => r.ok ? r.json() : null)
    .then(data => ({ name: studentName, dateMap: data ? parseDiary(data.lines) : {} }))
    .catch(() => ({ name: studentName, dateMap: {} }));
}

const STUDENT_LIST_PAGE = "IML 加藤研究室"; // 学生一覧を取得するページ（固定）

function fetchHeatmapData(_pathname) {
  const listPath = `/${AUTO_SHOW_PROJECT}/${encodeURIComponent(STUDENT_LIST_PAGE)}`;
  return fetch(`https://scrapbox.io/api/pages${listPath}`, { credentials: "include" })
    .then(r => { if (!r.ok) throw new Error(`学生一覧ページ取得失敗: HTTP ${r.status}`); return r.json(); })
    .then(pageData => {
      const students = parseStudentList(pageData.lines);
      return Promise.all(students.map(fetchStudentDiary));
    });
}

// ---- Firebase プレゼンス ----
let _meUser = null;
let _meUserFetchedAt = 0;
let _myPhoto    = null; // 自分のページアイコン URL キャッシュ（ページ開放時にリセット）
let _pagePhotos = {};  // name → Scrapbox ページアイコン URL キャッシュ
const ME_CACHE_TTL = 60 * 60 * 1000; // 1時間
let _heartbeatTimer = null;

// name が ID そのもの（16進数 20文字以上）かどうかを判定
function looksLikeId(name) {
  return /^[0-9a-f]{20,}$/i.test(name || "");
}

async function getMe() {
  if (_meUser && Date.now() - _meUserFetchedAt < ME_CACHE_TTL) return _meUser;
  return fetchAndCacheMe();
}

async function fetchAndCacheMe() {
  try {
    // /api/users/me でログイン中ユーザーを直接取得
    const meRes = await fetch(`https://scrapbox.io/api/users/me`, { credentials: "include" });
    if (!meRes.ok) return _meUser;
    const meData = await meRes.json();
    const id    = meData.id;
    const name  = meData.displayName || meData.name || "";
    const photo = meData.photo || meData.photoURL || "";
    if (!id || !name || looksLikeId(name)) return _meUser;
    _meUser = { id, name, photo };
    _meUserFetchedAt = Date.now();
  } catch { }
  return _meUser;
}

// Firebase キー：表示名ベース（ブラウザ拡張と常駐アプリで共通）
function presenceKey(name) {
  return encodeURIComponent(name.replace(/[.#$[\]]/g, "_"));
}

async function pushPresence() {
  if (!FIREBASE_URL || !isWithinProject()) return;
  const me = await getMe();
  if (!me || looksLikeId(me.name)) return; // IDのまま書き込まないフェイルセーフ
  // ユーザーページのサムネイル（[username.icon] の実体）を優先して使用
  if (_myPhoto === null) {
    _myPhoto = ""; // ページ API 失敗時はアイコンなし（OAuth 写真は使わない）
    try {
      const r = await fetch(`https://scrapbox.io/api/pages/${AUTO_SHOW_PROJECT}/${encodeURIComponent(me.name)}`, { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        if (data.image) _myPhoto = data.image;
      }
    } catch {}
  }
  const photo = _myPhoto;
  fetch(`${FIREBASE_URL}/presence/${presenceKey(me.name)}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: me.name, photo, ts: Math.floor(Date.now() / 1000) })
  }).catch(() => {});
}

function startHeartbeat() {
  if (_heartbeatTimer) return;
  pushPresence();
  _heartbeatTimer = setInterval(pushPresence, 30_000);
}

window.addEventListener("beforeunload", () => {
  if (!FIREBASE_URL || !_meUser) return;
  fetch(`${FIREBASE_URL}/presence/${presenceKey(_meUser.name)}.json`, {
    method: "DELETE", keepalive: true
  }).catch(() => {});
});

async function fetchPresence() {
  const r = await fetch(`${FIREBASE_URL}/presence.json`).catch(() => null);
  if (!r?.ok) return [];
  const data = await r.json().catch(() => null);
  if (!data || typeof data !== "object") return [];
  const now = Math.floor(Date.now() / 1000);
  // 名前でグループ化し、最新のエントリのみ残す
  // （拡張機能と常駐アプリがそれぞれ別キーで書き込んでいる場合の重複排除）
  const byName = {};
  for (const u of Object.values(data)) {
    if (!u || !u.ts || (now - u.ts) >= PRESENCE_TTL) continue;
    const name = u.name || "";
    if (!byName[name] || u.ts > byName[name].ts) byName[name] = u;
  }
  return Object.values(byName)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));
}

// ---- ページアイコン取得（チャット表示用） ----
async function fetchPagePhoto(name) {
  if (_pagePhotos[name] !== undefined) return _pagePhotos[name];
  _pagePhotos[name] = ""; // 取得中フラグ兼デフォルト値
  try {
    const r = await fetch(`https://scrapbox.io/api/pages/${AUTO_SHOW_PROJECT}/${encodeURIComponent(name)}`, { credentials: "include" });
    if (r.ok) {
      const data = await r.json();
      if (data.image) _pagePhotos[name] = data.image;
    }
  } catch {}
  return _pagePhotos[name];
}

// ---- チャット最新行取得 ----
async function fetchChatRecent(n = 1) {
  const path = `/${AUTO_SHOW_PROJECT}/${encodeURIComponent(CHAT_PAGE)}`;
  const r = await fetch(`https://scrapbox.io/api/pages${path}`, { credentials: "include" }).catch(() => null);
  if (!r?.ok) return [];
  const data = await r.json().catch(() => null);
  if (!data?.lines) return [];
  return data.lines
    .slice(1)                                    // タイトル行を除く
    .filter(l => l.text.trim() !== "")           // 空行を除く
    .sort((a, b) => b.updated - a.updated)       // 更新が新しい順
    .slice(0, n);
}

// ---- 通知 ----
async function sendNotification(toName) {
  if (!FIREBASE_URL) return;
  const me = await getMe();
  if (!me) return;
  fetch(`${FIREBASE_URL}/notifications/${presenceKey(toName)}/${presenceKey(me.name)}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: me.name, ts: Math.floor(Date.now() / 1000) })
  }).catch(() => {});
}

async function fetchMyNotifications() {
  if (!FIREBASE_URL) return [];
  const me = await getMe();
  if (!me) return [];
  const r = await fetch(`${FIREBASE_URL}/notifications/${presenceKey(me.name)}.json`).catch(() => null);
  if (!r?.ok) return [];
  const data = await r.json().catch(() => null);
  if (!data || typeof data !== "object") return [];
  const now = Math.floor(Date.now() / 1000);
  return Object.values(data)
    .filter(n => n && n.from && n.ts && (now - n.ts) < NOTIFICATION_TTL);
}

async function checkNotification() {
  const notifs = await fetchMyNotifications();
  const notifText = notifs.length > 0
    ? notifs.map(n => n.from).join("、") + "が呼んでいます"
    : null;

  // 再開ボタンの色
  const btn = document.getElementById("scrapbox-cv-reopen");
  if (btn) {
    btn.style.background = notifText ? "#e74c3c" : "#4a90e2";
    btn.title = notifText ?? "IML Viewer を表示";
  }

  // パネルヘッダーの色と通知テキスト
  if (_currentShadow && _currentHost?.isConnected) {
    const header = _currentShadow.getElementById("header");
    if (header) {
      if (notifText) {
        header.style.background = "#e74c3c";
        let span = _currentShadow.getElementById("notif-text");
        if (!span) {
          span = document.createElement("span");
          span.id = "notif-text";
          span.style.cssText = "color:#fff;font-size:11px;font-weight:bold;flex:1;text-align:left;padding-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
          header.insertBefore(span, header.firstChild);
        }
        span.textContent = notifText;
      } else {
        header.style.background = "";
        _currentShadow.getElementById("notif-text")?.remove();
      }
    }
  }
}

// ---- popup からのメッセージに応答 ----
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type !== "GET_CONTRIBUTIONS") return;
  fetchContributions().then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true;
});

// ---- UI 管理 ----
function removeExisting() {
  document.getElementById("scrapbox-cv-host")?.remove();
  document.getElementById("scrapbox-cv-reopen")?.remove();
}

function showReopenButton() {
  const btn = document.createElement("button");
  btn.id = "scrapbox-cv-reopen";
  btn.textContent = "IML";
  btn.title = "IML Viewer を表示";
  btn.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:99999;
    width:36px;height:36px;border-radius:50%;
    background:#4a90e2;color:#fff;border:none;
    font-size:11px;font-weight:bold;cursor:pointer;
    box-shadow:0 2px 8px rgba(0,0,0,.2);
  `;
  btn.addEventListener("click", () => { userDismissed = false; updateUI(); });
  document.body.appendChild(btn);
  checkNotification();
}

function updateUI() {
  removeExisting();
  if (!isWithinProject()) return;
  if (userDismissed) { showReopenButton(); return; }
  if (isHeatmapPage()) {
    showTabbedPanel([
      { label: "研究日誌一覧", init: initHeatmapTab },
      { label: "オンラインユーザー", init: initPresenceTab }
    ], "440px");
    return;
  }
  if (isContribPage()) {
    showTabbedPanel([
      { label: "貢献度", init: initContribTab },
      { label: "オンラインユーザー", init: initPresenceTab }
    ]);
    return;
  }
  if (isDiaryPage()) {
    showTabbedPanel([
      { label: "研究日誌", init: initDiaryTab },
      { label: "オンラインユーザー", init: initPresenceTab }
    ]);
    return;
  }
  // その他の IML ページ → オンラインユーザーのみ
  showTabbedPanel([{ label: "オンラインユーザー", init: initPresenceTab }]);
}

function onClose(hostEl) {
  userDismissed = true;
  hostEl.remove();
  if (isWithinProject()) showReopenButton();
}

// ---- タブパネル共通 ----
function showTabbedPanel(tabDefs, width = "280px") {
  removeExisting();
  const host = createHost(width);
  const shadow = host.attachShadow({ mode: "open" });
  _currentShadow = shadow;
  _currentHost   = host;
  const multi = tabDefs.length > 1;

  shadow.innerHTML = `
    <style>
      ${commonStyle(width)}
      ${navStyle()}
      ${multi ? `
        #tab-bar{display:flex;gap:3px;margin-bottom:8px;}
        .tab-btn{flex:1;padding:4px 0;font-size:11px;background:none;
          border:1px solid #ddd;cursor:pointer;color:#888;border-radius:4px;}
        .tab-btn.active{background:#4a90e2;color:#fff;border-color:#4a90e2;}
        .tab-btn:hover:not(.active){background:#f5f5f5;}
      ` : ""}
      .tab-pane{display:none;}
      .tab-pane.active{display:block;}
    </style>
    <div id="panel">
      <div id="header">
        <button id="close-btn" title="閉じる">×</button>
      </div>
      <div id="panel-body">
      ${multi ? `<div id="tab-bar">${tabDefs.map((t, i) =>
        `<button class="tab-btn${i === 0 ? " active" : ""}" data-i="${i}">${esc(t.label)}</button>`
      ).join("")}</div>` : ""}
      ${tabDefs.map((_, i) => `<div class="tab-pane${i === 0 ? " active" : ""}" id="pane-${i}"></div>`).join("")}
      </div>
    </div>`;

  shadow.getElementById("close-btn").addEventListener("click", () => onClose(host));

  const initialized = new Set();
  function activateTab(idx) {
    if (multi) {
      shadow.querySelectorAll(".tab-btn").forEach((b, i) => b.classList.toggle("active", i === idx));
    }
    shadow.querySelectorAll(".tab-pane").forEach((p, i) => p.classList.toggle("active", i === idx));
    if (!initialized.has(idx)) {
      initialized.add(idx);
      tabDefs[idx].init(shadow.getElementById(`pane-${idx}`), shadow, host);
    }
  }

  if (multi) {
    shadow.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => activateTab(Number(btn.dataset.i)));
    });
  }
  activateTab(0);
  document.body.appendChild(host);
  requestAnimationFrame(() => makeDraggable(host, shadow));
}

// ---- 貢献度タブ ----
function initContribTab(pane, shadow, host) {
  const pathname = location.pathname;
  pane.innerHTML = `<div style="font-size:11px;color:#aaa;padding:8px 0;text-align:center;">読み込み中...</div>`;
  const s = document.createElement("style");
  s.textContent = `
    .bar-row{display:flex;align-items:center;margin-bottom:7px;gap:7px;}
    .bar-label{width:90px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;}
    .bar-track{flex:1;height:14px;background:#f0f0f0;border-radius:4px;overflow:hidden;}
    .bar-fill{height:100%;border-radius:4px;}
    .bar-count{width:32px;font-size:11px;text-align:right;color:#666;flex-shrink:0;}
    #c-chart .bar-row:nth-child(1) .bar-fill{background:#4a90e2;}
    #c-chart .bar-row:nth-child(2) .bar-fill{background:#5ba85a;}
    #c-chart .bar-row:nth-child(3) .bar-fill{background:#e2844a;}
    #c-chart .bar-row:nth-child(4) .bar-fill{background:#9b59b6;}
    #c-chart .bar-row:nth-child(5) .bar-fill{background:#e74c3c;}
    #c-chart .bar-row:nth-child(n+6) .bar-fill{background:#95a5a6;}
    #c-toggle{display:none;width:100%;margin-top:6px;padding:5px 0;
      background:none;border:1px solid #ddd;border-radius:6px;
      font-size:11px;color:#888;cursor:pointer;text-align:center;}
    #c-toggle:hover{background:#f5f5f5;color:#555;}
    #c-total{margin-top:8px;font-size:10px;color:#bbb;text-align:right;}`;
  shadow.appendChild(s);

  fetchContributions(pathname).then(data => {
    if (!host.isConnected || location.pathname !== pathname) return;
    const all = data.contributions;
    const max = all[0]?.count || 1;
    let expanded = false;
    pane.innerHTML = `<div id="c-chart"></div><button id="c-toggle"></button><div id="c-total">合計 ${data.totalLines} 行</div>`;
    const chartEl = pane.querySelector("#c-chart");
    const toggleBtn = pane.querySelector("#c-toggle");
    for (const { name, count } of all) {
      const pct = Math.round((count / max) * 100);
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `<div class="bar-label" title="${esc(name)}">${esc(name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-count">${count}</div>`;
      chartEl.appendChild(row);
    }
    function applyLimit() {
      chartEl.querySelectorAll(".bar-row").forEach((r, i) => {
        r.style.display = expanded || i < LIMIT ? "" : "none";
      });
      if (all.length > LIMIT) {
        toggleBtn.style.display = "";
        toggleBtn.textContent = expanded ? "表示を少なく" : "もっと表示";
      }
    }
    toggleBtn.addEventListener("click", () => { expanded = !expanded; applyLimit(); });
    applyLimit();
  }).catch(err => {
    if (host.isConnected && location.pathname === pathname && err.message !== "Scrapboxのページではありません")
      pane.innerHTML = `<div style="font-size:11px;color:#aaa;padding:8px 0;">${esc(err.message)}</div>`;
  });
}

// ---- 研究日誌タブ ----
function initDiaryTab(pane, shadow, host) {
  const pathname = location.pathname;
  pane.innerHTML = `<div style="font-size:11px;color:#aaa;padding:8px 0;text-align:center;">読み込み中...</div>`;
  const s = document.createElement("style");
  s.textContent = `
    .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
    .day-hdr{font-size:10px;text-align:center;color:#999;padding:2px 0;}
    .day-hdr.sat{color:#4a90e2;} .day-hdr.sun{color:#e74c3c;}
    .day-cell{font-size:10px;text-align:center;border-radius:3px;
      padding:4px 0;min-height:28px;display:flex;align-items:center;justify-content:center;}
    .day-cell.empty{background:transparent;}`;
  shadow.appendChild(s);

  fetchDiaryData(pathname).then(data => {
    if (!host.isConnected || location.pathname !== pathname) return;
    const monthsMap = {};
    for (const [dateStr, count] of Object.entries(data.dateMap)) {
      const ym = dateStr.slice(0, 7);
      if (!monthsMap[ym]) monthsMap[ym] = {};
      monthsMap[ym][parseInt(dateStr.slice(8))] = count;
    }
    const monthKeys = Object.keys(monthsMap).sort();
    if (monthKeys.length === 0) {
      pane.innerHTML = `<div style="font-size:11px;color:#aaa;padding:8px 0;">日付行（[[Y/M/D]]）が見つかりませんでした</div>`;
      return;
    }
    let idx = monthKeys.length - 1;
    pane.innerHTML = `${monthNavHtml()}
      <div class="cal-grid" id="d-grid">
        <div class="day-hdr">月</div><div class="day-hdr">火</div>
        <div class="day-hdr">水</div><div class="day-hdr">木</div>
        <div class="day-hdr">金</div>
        <div class="day-hdr sat">土</div><div class="day-hdr sun">日</div>
      </div>`;
    const todayNum = (() => {
      const t = new Date();
      return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
    })();
    function render() {
      const ym = monthKeys[idx];
      const [y, m] = ym.split("-").map(Number);
      pane.querySelector("#month-label").textContent = `${y}年${m}月`;
      pane.querySelector("#prev-btn").disabled = idx === 0;
      pane.querySelector("#next-btn").disabled = idx === monthKeys.length - 1;
      const grid = pane.querySelector("#d-grid");
      while (grid.children.length > 7) grid.removeChild(grid.lastChild);
      const offset = (d => d === 0 ? 6 : d - 1)(new Date(y, m - 1, 1).getDay());
      const dayData = monthsMap[ym] || {};
      for (let i = 0; i < offset; i++) {
        const el = document.createElement("div"); el.className = "day-cell empty"; grid.appendChild(el);
      }
      for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
        const el = document.createElement("div");
        el.className = "day-cell";
        const isFuture = y * 10000 + m * 100 + d > todayNum;
        const c = dayData[d] ?? -1;
        el.style.background = isFuture ? "transparent" : dayColor(c);
        el.innerHTML = `<span>${d}</span>`;
        if (c >= 0 && !isFuture) el.title = `${c}文字`;
        grid.appendChild(el);
      }
    }
    pane.querySelector("#prev-btn").addEventListener("click", () => { idx--; render(); });
    pane.querySelector("#next-btn").addEventListener("click", () => { idx++; render(); });
    render();
  }).catch(err => {
    if (host.isConnected && location.pathname === pathname)
      pane.innerHTML = `<div style="font-size:11px;color:#aaa;padding:8px 0;">${esc(err.message)}</div>`;
  });
}

// ---- 研究日誌一覧タブ ----
function initHeatmapTab(pane, shadow, host) {
  const pathname = location.pathname;
  pane.innerHTML = `<div style="font-size:11px;color:#aaa;padding:12px 0;text-align:center;">読み込み中...</div>`;
  const s = document.createElement("style");
  s.textContent = `
    #hm-wrap{overflow-x:auto;}
    .hm-table{border-collapse:separate;border-spacing:2px;width:100%;}
    .hm-name{font-size:10px;text-align:right;padding-right:5px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px;color:#555;}
    .hm-name-link{cursor:pointer;color:#4a90e2;text-decoration:underline;}
    .hm-name-link:hover{color:#2c6fbd;}
    .hm-day-hdr{font-size:9px;text-align:center;color:#aaa;width:11px;min-width:11px;padding:0;}
    .hm-cell{width:11px;min-width:11px;height:11px;border-radius:2px;cursor:default;}`;
  shadow.appendChild(s);

  fetchHeatmapData(pathname).then(studentsData => {
    if (!host.isConnected || location.pathname !== pathname) return;
    const today = new Date();
    let year = today.getFullYear(), month = today.getMonth() + 1;
    pane.innerHTML = `${monthNavHtml()}<div id="hm-wrap"></div>`;
    function render() {
      pane.querySelector("#month-label").textContent = `${year}年${month}月`;
      const daysInMonth = new Date(year, month, 0).getDate();
      const ym = `${year}-${String(month).padStart(2, "0")}`;
      const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
      const table = document.createElement("table");
      table.className = "hm-table";
      const thead = document.createElement("tr");
      const nameHdr = document.createElement("td"); nameHdr.className = "hm-name";
      thead.appendChild(nameHdr);
      for (let d = 1; d <= daysInMonth; d++) {
        const th = document.createElement("td"); th.className = "hm-day-hdr"; th.textContent = d;
        thead.appendChild(th);
      }
      table.appendChild(thead);
      for (const { name, dateMap } of studentsData) {
        const tr = document.createElement("tr");
        const nameTd = document.createElement("td");
        nameTd.className = "hm-name hm-name-link";
        nameTd.textContent = name;
        nameTd.title = `【${name}】研究日誌 を開く`;
        nameTd.addEventListener("click", () => {
          location.href = `/${AUTO_SHOW_PROJECT}/${encodeURIComponent(`【${name}】研究日誌`)}`;
        });
        tr.appendChild(nameTd);
        for (let d = 1; d <= daysInMonth; d++) {
          const dateKey = `${ym}-${String(d).padStart(2, "0")}`;
          const isFuture = dateKey > todayKey;
          const c = dateMap[dateKey] ?? -1;
          const td = document.createElement("td");
          td.className = "hm-cell";
          td.style.background = isFuture ? "transparent" : dayColor(c);
          if (c >= 0 && !isFuture) td.title = `${name} ${year}/${month}/${d}：${c}文字`;
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      const wrap = pane.querySelector("#hm-wrap");
      wrap.innerHTML = ""; wrap.appendChild(table);
    }
    pane.querySelector("#prev-btn").addEventListener("click", () => { month--; if (month < 1) { month = 12; year--; } render(); });
    pane.querySelector("#next-btn").addEventListener("click", () => { month++; if (month > 12) { month = 1; year++; } render(); });
    render();
  }).catch(err => {
    if (host.isConnected && location.pathname === pathname)
      pane.innerHTML = `<div style="font-size:11px;color:#aaa;padding:8px 0;">${esc(err.message)}</div>`;
  });
}

// ---- オンラインユーザータブ ----
function initPresenceTab(pane, shadow, host) {
  const s = document.createElement("style");
  s.textContent = `
    #icon-grid{display:flex;flex-wrap:wrap;gap:8px;padding:4px 0;min-height:40px;}
    .u-wrap{position:relative;cursor:default;}
    .u-wrap.notifiable{cursor:pointer;}
    .u-wrap.notifiable:hover .u-icon,.u-wrap.notifiable:hover .u-initial{opacity:.8;}
    .u-icon{width:36px;height:36px;border-radius:50%;object-fit:cover;
      border:2px solid #4caf50;display:block;}
    .u-initial{width:36px;height:36px;border-radius:50%;background:#4a90e2;
      color:#fff;font-size:14px;font-weight:bold;display:flex;
      align-items:center;justify-content:center;border:2px solid #4caf50;}
    .u-tooltip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;
      transform:translateX(-50%);background:rgba(0,0,0,.75);color:#fff;
      font-size:10px;border-radius:4px;padding:4px 7px;white-space:nowrap;
      pointer-events:none;z-index:1;}
    .u-wrap:hover .u-tooltip{display:block;}
    #chat-recent{margin-top:10px;border-top:1px solid #eee;padding-top:8px;}
    .recent-line{font-size:11px;color:#333;line-height:1.8;word-break:break-all;}
    .line-icon{width:18px;height:18px;border-radius:50%;object-fit:cover;
      vertical-align:middle;margin:0 1px;}
    .line-initial{display:inline-flex;width:18px;height:18px;border-radius:50%;
      background:#4a90e2;color:#fff;font-size:8px;font-weight:bold;
      align-items:center;justify-content:center;
      vertical-align:middle;margin:0 1px;}
    .line-text{vertical-align:middle;}`;
  shadow.appendChild(s);
  pane.innerHTML = `
    <div id="icon-grid"><div style="font-size:11px;color:#aaa;padding:4px 0;">読み込み中...</div></div>
    <div id="chat-recent"></div>`;

  // ヘッダーに更新時刻スパンを追加
  const timeSpan = document.createElement("span");
  timeSpan.id = "upd-time";
  timeSpan.style.cssText = "font-size:10px;color:#aaa;flex:1;text-align:left;padding-left:2px;";
  const hdr = shadow.getElementById("header");
  if (hdr) hdr.insertBefore(timeSpan, hdr.firstChild);

  // 通知状態
  let _sentTo      = null;      // 自分が通知を送ったユーザー名
  let _sentTs      = null;      // 送った時刻（ts）
  let _ackedNotifs = new Map(); // from名 → ts（受信済み通知）
  let _lastClickTs = 0;         // 通知クリックのデバウンス用

  function tryNotifClick() {
    const now = Date.now();
    if (now - _lastClickTs < 1000) return false; // 1秒以内の連打を無視
    _lastClickTs = now;
    return true;
  }

  async function acknowledgeNotification(fromName, notifTs) {
    _ackedNotifs.set(fromName, notifTs);
    const me = await getMe();
    if (!me) return;
    fetch(`${FIREBASE_URL}/notifications/${presenceKey(me.name)}/${presenceKey(fromName)}.json`, {
      method: "DELETE"
    }).catch(() => {});
  }

  async function checkSentActive() {
    if (!_sentTo || !_sentTs) return false;
    const now = Math.floor(Date.now() / 1000);
    // 送信直後5秒はFirebaseへの書き込みが完了していない可能性があるためtrueとして扱う
    if (now - _sentTs < 5) return true;
    const me = await getMe();
    if (!me) return false;
    const r = await fetch(`${FIREBASE_URL}/notifications/${presenceKey(_sentTo)}/${presenceKey(me.name)}.json`).catch(() => null);
    if (!r?.ok) return false;
    const data = await r.json().catch(() => null);
    if (!data || data.ts !== _sentTs) return false;
    return (now - data.ts) < NOTIFICATION_TTL;
  }

  function renderLine(text, photoMap) {
    const cleaned = stripScrapboxNotation(text);
    const re = /\[([^\]]+)\.icon\]/g;
    let html = "", last = 0, m;
    while ((m = re.exec(cleaned)) !== null) {
      if (m.index > last) html += `<span class="line-text">${esc(cleaned.slice(last, m.index))}</span>`;
      const name = m[1];
      const photo = photoMap[name] || "";
      html += photo
        ? `<img class="line-icon" src="${esc(photo)}" alt="${esc(name)}" title="${esc(name)}">`
        : `<span class="line-initial" title="${esc(name)}">${esc((name || "?")[0])}</span>`;
      last = m.index + m[0].length;
    }
    if (last < cleaned.length) html += `<span class="line-text">${esc(cleaned.slice(last))}</span>`;
    return `<div class="recent-line">${html}</div>`;
  }

  async function refresh() {
    if (!FIREBASE_URL) {
      pane.querySelector("#icon-grid").innerHTML = `<div style="font-size:11px;color:#aaa;">FIREBASE_URL が未設定です</div>`;
      return;
    }

    const [users, me, notifs, sentActive] = await Promise.all([
      fetchPresence(),
      getMe(),
      fetchMyNotifications(),
      checkSentActive()
    ]);

    // 送信した通知が終了していたらクリア
    if (_sentTo && !sentActive) { _sentTo = null; _sentTs = null; }

    // 受信通知（既に受信済みのものは除く）
    const effectiveNotifs = notifs.filter(n => _ackedNotifs.get(n.from) !== n.ts);
    const callerNames = new Set(effectiveNotifs.map(n => n.from));

    // オンラインユーザー描画
    const g = pane.querySelector("#icon-grid");
    if (!g) return;
    if (users.length === 0) {
      g.innerHTML = `<div style="font-size:11px;color:#aaa;padding:4px 0;">オンラインユーザーなし</div>`;
    } else {
      g.innerHTML = "";
      for (const u of users) {
        const wrap = document.createElement("div");
        wrap.className = "u-wrap";
        const isSelf     = me && u.name === me.name;
        const isSentTo   = u.name === _sentTo;
        const isCallerOf = callerNames.has(u.name);

        // アイコン枠の色
        const borderColor = isSentTo   ? "#4a90e2"  // 青：自分が呼んだ
                          : isCallerOf ? "#e74c3c"  // 赤：向こうが呼んでいる
                          :              "#4caf50"; // 緑：通常

        const avatar = u.photo
          ? `<img class="u-icon" src="${esc(u.photo)}" alt="${esc(u.name)}" style="border-color:${borderColor}">`
          : `<div class="u-initial" style="border-color:${borderColor}">${esc((u.name||"?")[0])}</div>`;

        const tooltipText = isCallerOf ? `${esc(u.name)}（クリックで受信）`
                          : !isSelf   ? `${esc(u.name)}（クリックで呼ぶ）`
                          :              esc(u.name);

        wrap.innerHTML = `${avatar}<div class="u-tooltip">${tooltipText}</div>`;

        if (isCallerOf) {
          wrap.classList.add("notifiable");
          wrap.addEventListener("click", async () => {
            if (!tryNotifClick()) return;
            const callerNotif = effectiveNotifs.find(n => n.from === u.name);
            if (!callerNotif) return;
            await acknowledgeNotification(u.name, callerNotif.ts);
            // 残りの通知を確認してヘッダーを即座に更新
            const remaining = effectiveNotifs.filter(n => n.from !== u.name);
            const header = shadow.getElementById("header");
            if (header) {
              if (remaining.length > 0) {
                const span = shadow.getElementById("notif-text");
                if (span) span.textContent = remaining.map(n => n.from).join("、") + "が呼んでいます";
              } else {
                header.style.background = "";
                shadow.getElementById("notif-text")?.remove();
              }
            }
            const btn = document.getElementById("scrapbox-cv-reopen");
            if (btn) {
              if (remaining.length > 0) {
                btn.title = remaining.map(n => n.from).join("、") + "が呼んでいます";
              } else {
                btn.style.background = "#4a90e2";
                btn.title = "IML Viewer を表示";
              }
            }
            refresh();
          });
        } else if (!isSelf) {
          wrap.classList.add("notifiable");
          wrap.addEventListener("click", () => {
            if (!tryNotifClick()) return;
            _sentTo = u.name;
            _sentTs = Math.floor(Date.now() / 1000);
            sendNotification(u.name);
            // 即座にアイコン枠を青色にする（refresh() の完了を待たない）
            const iconEl = wrap.querySelector(".u-icon, .u-initial");
            if (iconEl) iconEl.style.borderColor = "#4a90e2";
            refresh();
          });
        }
        g.appendChild(wrap);
      }
    }

    const t = shadow.getElementById("upd-time");
    if (t) t.textContent = new Date().toLocaleTimeString("ja-JP");

    // チャット最新行
    fetchChatRecent(1).then(async lines => {
      const cr = pane.querySelector("#chat-recent");
      if (!cr) return;
      if (lines.length === 0) { cr.innerHTML = ""; return; }
      // [name.icon] に登場するユーザーのページアイコンを取得
      const iconNames = new Set();
      for (const l of lines) {
        const re = /\[([^\]]+)\.icon\]/g;
        let m;
        while ((m = re.exec(stripScrapboxNotation(l.text))) !== null) iconNames.add(m[1]);
      }
      const photoMap = Object.fromEntries(
        await Promise.all([...iconNames].map(async n => [n, await fetchPagePhoto(n)]))
      );
      cr.innerHTML = lines.map(l => renderLine(l.text, photoMap)).join("");
    });
  }

  pushPresence().then(() => refresh());
  const timer = setInterval(() => {
    if (!host.isConnected) { clearInterval(timer); return; }
    refresh();
  }, 30_000);
}

// ---- 色計算 ----
function dayColor(charCount) {
  if (charCount < 0)   return "rgba(200,200,200,0.2)";
  if (charCount === 0) return "rgba(255,0,0,0.3)";
  const step = Math.min(9, Math.floor((charCount - 1) / 100));
  return `rgba(0,100,255,${(10 + step * 10) / 100})`;
}

// ---- 共通ヘルパー ----
function createHost(width) {
  const host = document.createElement("div");
  host.id = "scrapbox-cv-host";
  host.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:99999;";
  if (width) host.dataset.width = width;
  return host;
}

function makeDraggable(host, shadow) {
  // bottom/right → top/left に変換して固定
  const rect = host.getBoundingClientRect();
  host.style.bottom = "";
  host.style.right  = "";
  host.style.top    = `${rect.top}px`;
  host.style.left   = `${rect.left}px`;

  const handle = shadow.getElementById("header");
  if (!handle) return;

  handle.style.cursor = "grab";

  let dragging = false, startX, startY, startLeft, startTop;

  handle.addEventListener("mousedown", e => {
    dragging = true;
    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = parseInt(host.style.left);
    startTop  = parseInt(host.style.top);
    handle.style.cursor = "grabbing";
    e.preventDefault();
  });

  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    host.style.left = `${startLeft + e.clientX - startX}px`;
    host.style.top  = `${startTop  + e.clientY - startY}px`;
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = "grab";
  });
}

function commonStyle(width = "280px") {
  return `
    *{box-sizing:border-box;margin:0;padding:0;}
    #panel{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      width:${width};background:#fff;border:1px solid #ddd;border-radius:10px;
      box-shadow:0 4px 16px rgba(0,0,0,.15);overflow:hidden;color:#333;}
    #header{display:flex;align-items:center;justify-content:flex-end;
      background:#f0f0f0;padding:4px 6px;cursor:grab;}
    #header:active{cursor:grabbing;}
    #close-btn{background:none;border:none;font-size:15px;color:#aaa;cursor:pointer;line-height:1;padding:0 2px;}
    #close-btn:hover{color:#555;}
    #panel-body{padding:12px 16px 12px;}`;
}

function navStyle() {
  return `
    #month-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
    #month-label{font-size:12px;font-weight:600;color:#444;}
    .nav-btn{background:none;border:1px solid #ddd;border-radius:4px;
      font-size:12px;color:#888;cursor:pointer;padding:2px 7px;line-height:1.4;}
    .nav-btn:hover{background:#f5f5f5;}
    .nav-btn:disabled{opacity:.3;cursor:default;}`;
}

function monthNavHtml() {
  return `<div id="month-nav">
    <button class="nav-btn" id="prev-btn">&#8249;</button>
    <span id="month-label"></span>
    <button class="nav-btn" id="next-btn">&#8250;</button>
  </div>`;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Scrapbox 記法を除去（[name.icon] は保持）
function stripScrapboxNotation(text) {
  let s = text;
  let i = 0;
  while (i < s.length) {
    if (s[i] !== "[") { i++; continue; }
    // 対応する ] を探しながら最初の空白位置を記録
    let depth = 1, j = i + 1, wsPos = -1, closePos = -1;
    while (j < s.length) {
      if      (s[j] === "[") { depth++; }
      else if (s[j] === "]") { depth--; if (depth === 0) { closePos = j; break; } }
      else if (depth === 1 && wsPos === -1 && /\s/.test(s[j])) { wsPos = j; }
      j++;
    }
    if (closePos === -1) { i++; continue; } // 対応する ] がない
    const inner = s.slice(i + 1, closePos);
    if (wsPos !== -1) {
      // [修飾子 本文] → 本文　例: [* bold] → bold, [https://url text] → text
      s = s.slice(0, closePos) + s.slice(closePos + 1); // ] を削除
      s = s.slice(0, i)        + s.slice(wsPos + 1);    // [ から空白まで削除
      // i はそのまま（残った本文を再スキャン）
    } else if (/^[^\s\[\]]+\.icon$/.test(inner)) {
      // [name.icon] はアイコン置換のために保持
      i = closePos + 1;
    } else {
      // 空白なし・icon でない → [ と ] だけ除去（中身は残す）
      s = s.slice(0, closePos) + s.slice(closePos + 1);
      s = s.slice(0, i)        + s.slice(i + 1);
      // i はそのまま（中身を再スキャン）
    }
  }
  return s;
}

// ---- 個人研究日誌ページの最下部スクロール ----
function isPersonalDiaryPage() {
  return /^【.+】研究日誌$/.test(pageTitle());
}

function scrollToToday() {
  const now = new Date();
  const todayNum = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  const DATE_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;

  function collectDates() {
    // Scrapbox は [[Y/M/D]] を <a> や <span> として描画する
    const seen = new Map(); // dateNum → el
    for (const el of document.body.querySelectorAll("a, span")) {
      const text = el.textContent.trim();
      if (text.length > 15) continue; // 日付のみの短い要素に限定
      const m = text.match(DATE_RE);
      if (!m) continue;
      const dateNum = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
      if (!seen.has(dateNum)) seen.set(dateNum, el);
    }
    return seen;
  }

  function tryScroll() {
    const dates = collectDates();
    if (dates.size === 0) return false;

    // 今日の行を優先
    if (dates.has(todayNum)) {
      dates.get(todayNum).scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }

    // 今日以前で最も近い日付
    let best = null;
    for (const [dateNum, el] of dates) {
      if (dateNum < todayNum && (best === null || dateNum > best.dateNum)) {
        best = { dateNum, el };
      }
    }
    if (best) {
      best.el.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }

    return false;
  }

  const start = Date.now();
  const timer = setInterval(() => {
    const found = tryScroll();
    if (found || Date.now() - start > 8000) {
      clearInterval(timer);
    }
  }, 300);
}

// ---- チャットページの related-page-list 直前へスクロール ----
function scrollToChatBottom() {
  const start = Date.now();
  const timer = setInterval(() => {
    const el = document.querySelector(".related-page-list");
    if (el) {
      const rect = el.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight, behavior: "smooth" });
      clearInterval(timer);
    } else if (Date.now() - start > 8000) {
      clearInterval(timer);
    }
  }, 300);
}

// ---- SPA ナビゲーション監視 ----
let lastUrl = location.href;
setInterval(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  updateUI();
  if (isPersonalDiaryPage()) scrollToToday();
  if (isPresencePage()) scrollToChatBottom();
  if (isWithinProject()) pushPresence();
}, 300);

updateUI();
if (isPersonalDiaryPage()) scrollToToday();
if (isPresencePage()) scrollToChatBottom();
startHeartbeat();
checkNotification();
setInterval(checkNotification, 30_000);
