// UI Elements
const totalCount = document.getElementById('totalCount');
const rescanBtn = document.getElementById('rescan');
const scanStatus = document.getElementById('scanStatus');
const scannedList = document.getElementById('scanned-list');
const highlightCheckbox = document.getElementById('highlightOnPage');

let scanInterval = 1000; // ms
let scanTimer = null;
let nextScanTime = null;

// Messaging helpers
function sendMessageToTab(msg) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return resolve(undefined);
      const tabId = tabs[0].id;
      chrome.tabs.sendMessage(tabId, msg, (res) => {
        if (chrome.runtime.lastError) return resolve(undefined);
        resolve(res);
      });
    });
  });
}

function sendToBackground(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return resolve(undefined);
      resolve(res);
    });
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

// Scan timer helpers
function updateScanStatus() {
  if (nextScanTime) {
    const ms = Math.max(0, nextScanTime - Date.now());
    scanStatus.textContent = `Rescanning ${Math.ceil(ms / 1000)}sec`;
  } else {
    scanStatus.textContent = '';
  }
}

function scheduleNextScan() {
  if (scanTimer) clearTimeout(scanTimer);
  nextScanTime = Date.now() + scanInterval;
  updateScanStatus();
  scanTimer = setTimeout(() => {
    triggerRescan();
  }, scanInterval);
}

// Render UI
async function loadAndRender() {
  const res = await sendToBackground({ type: 'getDetoxLog' });
  if (!res) return;

  const pairs = res.pairs || [];
  let scanned = res.allScanned || [];

  // Get active tab id to filter logs for the current page
  const activeTab = await new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve((tabs && tabs[0]) || null);
      });
    } catch (e) {
      resolve(null);
    }
  });
  const activeTabId = activeTab ? activeTab.id : null;

  if (activeTabId != null) {
    scanned = scanned.filter((s) => (s.tabId == null ? false : s.tabId === activeTabId));
  }

  // Map detox outputs by id and by original text for fallback
  const detoxById = new Map();
  const detoxByText = new Map();
  for (const p of pairs) {
    if (p.id != null) detoxById.set(String(p.id), p);
    if (p.original) detoxByText.set(String(p.original), p);
  }

  totalCount.textContent = scanned.length;
  scannedList.innerHTML = '';

  // Build items with computed statuses, then sort: Red, Green, Yellow, Brown
  const itemsWithStatus = scanned.map((item) => {
    const id = item.id != null ? String(item.id) : null;
    const text = item.text || '';
    let status = 'yellow';
    if (item.isToxic === null || item.isToxic === undefined) status = 'yellow';
    else if (item.isToxic === false) status = 'green';
    else if (item.isToxic === true) {
      const d = id ? detoxById.get(id) : detoxByText.get(String(text));
      status = d ? 'red' : 'brown';
    }
    return { item, id, text, status };
  });

  const order = { red: 0, green: 1, yellow: 2, brown: 3 };
  itemsWithStatus.sort((a, b) => (order[a.status] - order[b.status]));

  for (const entry of itemsWithStatus) {
    const { item, id, text, status } = entry;
    const div = document.createElement('div');
    div.className = 'scan-item';
    div.dataset.id = id;

    const badge = document.createElement('span');
    badge.className = `status-badge status-${status}`;
    badge.textContent = status.toUpperCase();

    const main = document.createElement('div');
    main.innerHTML = escapeHtml(text);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const ts = item.timestamp ? new Date(item.timestamp).toLocaleString() : '';
    meta.textContent = ts + (id ? ` | id: ${id}` : '');

    div.appendChild(badge);
    div.appendChild(main);
    div.appendChild(meta);

    div.addEventListener('click', () => {
      if (!id) return;
      sendMessageToTab({ type: 'applyColor', id: id, status });
    });

    scannedList.appendChild(div);
  }

  // apply highlights if toggle is on
  if (highlightCheckbox.checked) {
    applyHighlightsToPage();
  }
}

// Refresh popup when the active tab changes or finishes loading
try {
  chrome.tabs.onActivated.addListener(() => {
    loadAndRender();
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo && changeInfo.status === 'complete') loadAndRender();
  });
} catch (e) {
  // ignore if tabs permission not present
}

async function applyHighlightsToPage() {
  const res = await sendToBackground({ type: 'getDetoxLog' });
  if (!res) return;
  const pairs = res.pairs || [];
  let scanned = res.allScanned || [];

  // filter to active tab
  const activeTab = await new Promise((resolve) => {
    try { chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve((tabs && tabs[0]) || null)); }
    catch (e) { resolve(null); }
  });
  const activeTabId = activeTab ? activeTab.id : null;
  if (activeTabId != null) scanned = scanned.filter(s => s.tabId === activeTabId);

  const detoxById = new Map();
  const detoxByText = new Map();
  for (const p of pairs) {
    if (p.id != null) detoxById.set(String(p.id), p);
    if (p.original) detoxByText.set(String(p.original), p);
  }

  for (const item of scanned) {
    const id = item.id != null ? String(item.id) : null;
    if (!id) continue;

    let status = 'yellow';
    if (item.isToxic === null || item.isToxic === undefined) status = 'yellow';
    else if (item.isToxic === false) status = 'green';
    else if (item.isToxic === true) {
      const d = detoxById.get(id) || detoxByText.get(String(item.text));
      status = d ? 'red' : 'brown';
    }

    await sendMessageToTab({ type: 'applyColor', id, status });
  }
}

async function clearHighlightsOnPage() {
  const res = await sendToBackground({ type: 'getDetoxLog' });
  if (!res) return;
  let scanned = res.allScanned || [];
  const activeTab = await new Promise((resolve) => {
    try { chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve((tabs && tabs[0]) || null)); }
    catch (e) { resolve(null); }
  });
  const activeTabId = activeTab ? activeTab.id : null;
  if (activeTabId != null) scanned = scanned.filter(s => s.tabId === activeTabId);
  for (const item of scanned) {
    const id = item.id != null ? String(item.id) : null;
    if (!id) continue;
    await sendMessageToTab({ type: 'removeColor', id });
  }
}

async function triggerRescan() {
  scanStatus.textContent = 'Rescanning...';
  await sendMessageToTab({ type: 'triggerRescan' });
  setTimeout(loadAndRender, 500);
  scheduleNextScan();
}

rescanBtn.addEventListener('click', () => {
  triggerRescan();
});

highlightCheckbox.addEventListener('change', () => {
  if (highlightCheckbox.checked) applyHighlightsToPage();
  else clearHighlightsOnPage();
});

// Open advanced settings page
const openSettingsBtn = document.getElementById('openSettings');
if (openSettingsBtn) {
  openSettingsBtn.addEventListener('click', () => {
    try {
      const url = chrome.runtime.getURL('settings.html');
      chrome.tabs.create({ url });
    } catch (e) {
      // fallback: open in same popup (not ideal)
      window.open('settings.html', '_blank');
    }
  });
}

// Initial load
loadAndRender();
scheduleNextScan();

// Update scan status every 200ms
setInterval(updateScanStatus, 200);