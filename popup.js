const LIMIT = 10;

const statusEl = document.getElementById("status");
const chartEl = document.getElementById("chart");
const pageTitleEl = document.getElementById("page-title");
const totalEl = document.getElementById("total");
const toggleBtn = document.getElementById("toggle-btn");

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab?.id || !tab.url?.startsWith("https://scrapbox.io/")) {
    statusEl.textContent = "Scrapboxのページで開いてください";
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "GET_CONTRIBUTIONS" }, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = "ページを再読み込みしてから試してください";
      return;
    }
    if (!response || response.error) {
      statusEl.textContent = response?.error || "取得に失敗しました";
      return;
    }

    statusEl.style.display = "none";
    pageTitleEl.textContent = response.title;

    const all = response.contributions;
    const max = all[0]?.count || 1;
    let expanded = false;

    // 全バーを先に生成しておき、表示/非表示で切り替える
    for (const { name, count } of all) {
      const pct = Math.round((count / max) * 100);
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `
        <div class="bar-label" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="bar-count">${count}</div>
      `;
      chartEl.appendChild(row);
    }

    function applyLimit() {
      const rows = chartEl.querySelectorAll(".bar-row");
      rows.forEach((row, i) => {
        row.style.display = expanded || i < LIMIT ? "" : "none";
      });
      if (all.length > LIMIT) {
        toggleBtn.style.display = "";
        toggleBtn.textContent = expanded ? "表示を少なく" : "もっと表示";
      }
    }

    toggleBtn.addEventListener("click", () => {
      expanded = !expanded;
      applyLimit();
    });

    applyLimit();
    totalEl.textContent = `合計 ${response.totalLines} 行`;
  });
});

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
