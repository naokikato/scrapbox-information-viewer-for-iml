// ---- 設定 ----
const AUTO_SHOW_PROJECT  = "IML";
const CONTRIB_KEYWORD    = "議事録";
const DIARY_KEYWORD      = "研究日誌";
const HEATMAP_PAGE_TITLES = ["加藤研究室", "年度"]; // ヒートマップを表示するページのタイトルに含まれる文字列（いずれかにマッチ）
const EXCLUDE_USERS      = ["加藤直樹"];
const LIMIT = 10;
// --------------

let userDismissed = false;

// ---- URL 判定 ----
function isWithinProject() {
  return location.pathname.startsWith(`/${AUTO_SHOW_PROJECT}/`);
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

// ---- データ取得（貢献度） ----
function fetchContributions(pathname = location.pathname) {
  const match = pathname.match(/^\/([^/]+)\/(.+)$/);
  if (!match) return Promise.reject(new Error("Scrapboxのページではありません"));
  const [, project] = match;
  return Promise.all([
    fetch(`https://scrapbox.io/api/pages${pathname}`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`ページAPI: HTTP ${r.status}`); return r.json(); }),
    fetch(`https://scrapbox.io/api/projects/${project}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null),
  ]).then(([pageData, projectData]) => {
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
    const contributions = Object.entries(userLineCount)
      .map(([uid, count]) => ({ name: userNames[uid] || uid, count }))
      .filter(({ name }) => !EXCLUDE_USERS.includes(name))
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
  btn.textContent = "CV";
  btn.title = "Contribution Viewer を表示";
  btn.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:99999;
    width:36px;height:36px;border-radius:50%;
    background:#4a90e2;color:#fff;border:none;
    font-size:11px;font-weight:bold;cursor:pointer;
    box-shadow:0 2px 8px rgba(0,0,0,.2);
  `;
  btn.addEventListener("click", () => { userDismissed = false; updateUI(); });
  document.body.appendChild(btn);
}

function updateUI() {
  removeExisting();
  if (!isWithinProject()) return;
  if (isHeatmapPage()  && !userDismissed) { showHeatmapPanel();  return; }
  if (isContribPage()  && !userDismissed) { showContribPanel();  return; }
  if (isDiaryPage()    && !userDismissed) { showDiaryPanel();    return; }
  showReopenButton();
}

function onClose(hostEl) {
  userDismissed = true;
  hostEl.remove();
  if (isWithinProject()) showReopenButton();
}

// ---- 貢献度パネル ----
function showContribPanel() {
  const pathname = location.pathname;
  removeExisting();
  fetchContributions(pathname)
    .then(data => {
      if (location.pathname !== pathname) return;
      document.body.appendChild(buildContribPanel(data));
    })
    .catch(err => {
      if (location.pathname === pathname && err.message !== "Scrapboxのページではありません")
        console.warn("[ScrapboxCV]", err.message);
    });
}

function buildContribPanel(data) {
  const host = createHost();
  const shadow = host.attachShadow({ mode: "open" });
  const all = data.contributions;
  const max = all[0]?.count || 1;
  let expanded = false;

  shadow.innerHTML = `
    <style>
      ${commonStyle()}
      .bar-row{display:flex;align-items:center;margin-bottom:7px;gap:7px;}
      .bar-label{width:90px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;}
      .bar-track{flex:1;height:14px;background:#f0f0f0;border-radius:4px;overflow:hidden;}
      .bar-fill{height:100%;border-radius:4px;}
      .bar-count{width:32px;font-size:11px;text-align:right;color:#666;flex-shrink:0;}
      .bar-row:nth-child(1) .bar-fill{background:#4a90e2;}
      .bar-row:nth-child(2) .bar-fill{background:#5ba85a;}
      .bar-row:nth-child(3) .bar-fill{background:#e2844a;}
      .bar-row:nth-child(4) .bar-fill{background:#9b59b6;}
      .bar-row:nth-child(5) .bar-fill{background:#e74c3c;}
      .bar-row:nth-child(n+6) .bar-fill{background:#95a5a6;}
      #toggle-btn{display:none;width:100%;margin-top:6px;padding:5px 0;
        background:none;border:1px solid #ddd;border-radius:6px;
        font-size:11px;color:#888;cursor:pointer;text-align:center;}
      #toggle-btn:hover{background:#f5f5f5;color:#555;}
      #total{margin-top:8px;font-size:10px;color:#bbb;text-align:right;}
    </style>
    <div id="panel">
      ${headerHtml("貢献度")}
      <div id="chart"></div>
      <button id="toggle-btn"></button>
      <div id="total"></div>
    </div>`;

  shadow.getElementById("total").textContent = `合計 ${data.totalLines} 行`;
  const chartEl = shadow.getElementById("chart");
  for (const { name, count } of all) {
    const pct = Math.round((count / max) * 100);
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label" title="${esc(name)}">${esc(name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-count">${count}</div>`;
    chartEl.appendChild(row);
  }
  const toggleBtn = shadow.getElementById("toggle-btn");
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
  shadow.getElementById("close-btn").addEventListener("click", () => onClose(host));
  applyLimit();
  requestAnimationFrame(() => makeDraggable(host, shadow));
  return host;
}

// ---- 日誌カレンダーパネル ----
function showDiaryPanel() {
  const pathname = location.pathname;
  removeExisting();
  fetchDiaryData(pathname)
    .then(data => {
      if (location.pathname !== pathname) return;
      document.body.appendChild(buildDiaryPanel(data));
    })
    .catch(err => {
      if (location.pathname === pathname && err.message !== "Scrapboxのページではありません")
        console.warn("[ScrapboxCV]", err.message);
    });
}

function buildDiaryPanel(data) {
  const host = createHost();
  const shadow = host.attachShadow({ mode: "open" });

  const monthsMap = {};
  for (const [dateStr, count] of Object.entries(data.dateMap)) {
    const ym = dateStr.slice(0, 7);
    if (!monthsMap[ym]) monthsMap[ym] = {};
    monthsMap[ym][parseInt(dateStr.slice(8))] = count;
  }
  const monthKeys = Object.keys(monthsMap).sort();
  if (monthKeys.length === 0) {
    shadow.innerHTML = `<style>${commonStyle()}</style>
      <div id="panel">${headerHtml("研究日誌")}
        <div style="font-size:11px;color:#aaa;padding:8px 0;">日付行（[[Y/M/D]]）が見つかりませんでした</div>
      </div>`;
    shadow.getElementById("close-btn").addEventListener("click", () => onClose(host));
    return host;
  }

  let idx = monthKeys.length - 1;
  shadow.innerHTML = `
    <style>
      ${commonStyle()}
      ${navStyle()}
      .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
      .day-hdr{font-size:10px;text-align:center;color:#999;padding:2px 0;}
      .day-hdr.sat{color:#4a90e2;} .day-hdr.sun{color:#e74c3c;}
      .day-cell{font-size:10px;text-align:center;border-radius:3px;
        padding:4px 0;min-height:28px;display:flex;align-items:center;justify-content:center;}
      .day-cell.empty{background:transparent;}
    </style>
    <div id="panel">
      ${headerHtml("研究日誌")}
      ${monthNavHtml()}
      <div class="cal-grid" id="cal-grid">
        <div class="day-hdr">月</div><div class="day-hdr">火</div>
        <div class="day-hdr">水</div><div class="day-hdr">木</div>
        <div class="day-hdr">金</div>
        <div class="day-hdr sat">土</div><div class="day-hdr sun">日</div>
      </div>
    </div>`;

  shadow.getElementById("close-btn").addEventListener("click", () => onClose(host));

  function render() {
    const ym = monthKeys[idx];
    const [y, m] = ym.split("-").map(Number);
    shadow.getElementById("month-label").textContent = `${y}年${m}月`;
    shadow.getElementById("prev-btn").disabled = idx === 0;
    shadow.getElementById("next-btn").disabled = idx === monthKeys.length - 1;
    const grid = shadow.getElementById("cal-grid");
    while (grid.children.length > 7) grid.removeChild(grid.lastChild);
    const offset = (d => d === 0 ? 6 : d - 1)(new Date(y, m - 1, 1).getDay());
    const dayData = monthsMap[ym] || {};
    for (let i = 0; i < offset; i++) {
      const el = document.createElement("div"); el.className = "day-cell empty"; grid.appendChild(el);
    }
    for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
      const el = document.createElement("div");
      el.className = "day-cell";
      const c = dayData[d] ?? -1;
      el.style.background = dayColor(c);
      el.innerHTML = `<span>${d}</span>`;
      if (c >= 0) el.title = `${c}文字`;
      grid.appendChild(el);
    }
  }
  shadow.getElementById("prev-btn").addEventListener("click", () => { idx--; render(); });
  shadow.getElementById("next-btn").addEventListener("click", () => { idx++; render(); });
  render();
  requestAnimationFrame(() => makeDraggable(host, shadow));
  return host;
}

// ---- ヒートマップパネル ----
function showHeatmapPanel() {
  const pathname = location.pathname;

  // ローディング表示
  const loading = createHost("440px");
  loading.attachShadow({ mode: "open" }).innerHTML = `
    <style>${commonStyle("440px")}</style>
    <div id="panel">${headerHtml("研究日誌一覧")}
      <div style="font-size:11px;color:#aaa;padding:12px 0;text-align:center;">読み込み中...</div>
    </div>`;
  document.body.appendChild(loading);
  loading.shadowRoot.getElementById("close-btn").addEventListener("click", () => onClose(loading));

  fetchHeatmapData(pathname)
    .then(studentsData => {
      if (location.pathname !== pathname) { loading.remove(); return; }
      loading.remove();
      document.body.appendChild(buildHeatmapPanel(studentsData));
    })
    .catch(err => {
      loading.remove();
      if (location.pathname === pathname) console.warn("[ScrapboxCV]", err.message);
    });
}

function buildHeatmapPanel(studentsData) {
  const host = createHost("440px");
  const shadow = host.attachShadow({ mode: "open" });

  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth() + 1;

  shadow.innerHTML = `
    <style>
      ${commonStyle("440px")}
      ${navStyle()}
      #heatmap { overflow-x: auto; }
      .hm-table { border-collapse: separate; border-spacing: 2px; width: 100%; }
      .hm-name {
        font-size: 10px; text-align: right; padding-right: 5px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        max-width: 80px; color: #555;
      }
      .hm-name-link { cursor: pointer; color: #4a90e2; text-decoration: underline; }
      .hm-name-link:hover { color: #2c6fbd; }
      .hm-day-hdr {
        font-size: 9px; text-align: center; color: #aaa;
        width: 11px; min-width: 11px; padding: 0;
      }
      .hm-cell {
        width: 11px; min-width: 11px; height: 11px;
        border-radius: 2px; cursor: default;
      }
    </style>
    <div id="panel">
      ${headerHtml("研究日誌一覧")}
      ${monthNavHtml()}
      <div id="heatmap"></div>
    </div>`;

  shadow.getElementById("close-btn").addEventListener("click", () => onClose(host));

  function render() {
    shadow.getElementById("month-label").textContent = `${year}年${month}月`;
    shadow.getElementById("prev-btn").disabled = false;
    shadow.getElementById("next-btn").disabled = false;

    const daysInMonth = new Date(year, month, 0).getDate();
    const ym = `${year}-${String(month).padStart(2, "0")}`;

    const table = document.createElement("table");
    table.className = "hm-table";

    // ヘッダー行（日付）
    const thead = document.createElement("tr");
    const nameHdr = document.createElement("td");
    nameHdr.className = "hm-name";
    thead.appendChild(nameHdr);
    for (let d = 1; d <= daysInMonth; d++) {
      const th = document.createElement("td");
      th.className = "hm-day-hdr";
      th.textContent = d;
      thead.appendChild(th);
    }
    table.appendChild(thead);

    // 学生行
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
        const c = dateMap[dateKey] ?? -1;
        const td = document.createElement("td");
        td.className = "hm-cell";
        td.style.background = dayColor(c);
        if (c >= 0) td.title = `${name} ${year}/${month}/${d}：${c}文字`;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }

    const heatmap = shadow.getElementById("heatmap");
    heatmap.innerHTML = "";
    heatmap.appendChild(table);
  }

  shadow.getElementById("prev-btn").addEventListener("click", () => {
    month--; if (month < 1) { month = 12; year--; } render();
  });
  shadow.getElementById("next-btn").addEventListener("click", () => {
    month++; if (month > 12) { month = 1; year++; } render();
  });

  render();
  requestAnimationFrame(() => makeDraggable(host, shadow));
  return host;
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
      box-shadow:0 4px 16px rgba(0,0,0,.15);padding:14px 16px 12px;color:#333;}
    #header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
    #title-text{font-size:13px;font-weight:600;color:#555;}
    #close-btn{background:none;border:none;font-size:16px;color:#aaa;cursor:pointer;line-height:1;padding:0 2px;}
    #close-btn:hover{color:#555;}`;
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

function headerHtml(title) {
  return `<div id="header">
    <span id="title-text">${esc(title)}</span>
    <button id="close-btn" title="閉じる">×</button>
  </div>`;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

// ---- SPA ナビゲーション監視 ----
let lastUrl = location.href;
setInterval(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  userDismissed = false;
  updateUI();
  if (isPersonalDiaryPage()) scrollToToday();
}, 300);

updateUI();
if (isPersonalDiaryPage()) scrollToToday();
