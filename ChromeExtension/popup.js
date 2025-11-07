// --- UI Elements ---
const changedCount = document.getElementById('changedCount');
const rescanBtn = document.getElementById('rescan');
const scanStatus = document.getElementById('scanStatus');
const changedList = document.getElementById('detox-changed-list');

let scanInterval = 1000; // ms
let scanTimer = null;
let nextScanTime = null;

// --- Messaging helpers ---
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

// --- UI rendering ---
function renderDetoxTable(pairs) {
  detoxTableBody.innerHTML = '';
  if (!pairs || !pairs.length) {
    changedCount.textContent = '0';
    return;
  }
  changedCount.textContent = pairs.length;
  for (const p of pairs) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="background:#ffecec;">${escapeHtml(p.original)}</td>
      <td style="background:#e6ffed;">${escapeHtml(p.detoxified)}${p.attempts ? ` <span style='color:#888;font-size:11px;'>(Attempts: ${p.attempts}${p.error ? ', Error: ' + escapeHtml(p.error) : ''})</span>` : ''}</td>
    `;
    detoxTableBody.appendChild(tr);
  }
}


function renderResultsPanel(pairs) {
  changedList.innerHTML = '';
  changedCount.textContent = pairs?.length || 0;
  
  if (pairs && pairs.length) {
    for (const p of pairs) {
      const div = document.createElement('div');
      div.style.background = '#fff0f0';
      div.style.padding = '12px';
      div.style.borderRadius = '4px';
      div.style.wordBreak = 'break-word';
      div.style.marginBottom = '8px';
      
      const before = document.createElement('div');
      before.style.color = '#b30000';
      before.textContent = p.original;
      
      const after = document.createElement('div');
      after.style.marginTop = '8px';
      after.style.color = '#006400';
      after.textContent = p.detoxified;
      
      if (p.attempts) {
        const info = document.createElement('div');
        info.style.marginTop = '4px';
        info.style.fontSize = '11px';
        info.style.color = '#666';
        info.textContent = `Attempts: ${p.attempts}${p.error ? ' | Error: ' + p.error : ''}`;
        after.appendChild(info);
      }
      
      div.appendChild(before);
      div.appendChild(after);
      changedList.appendChild(div);
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

// --- Scan timer ---
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

// --- Main logic ---
async function loadAndRender() {
  // Get toxic/detox pairs from background
  const res = await sendToBackground({ type: 'getDetoxLog' });
  if (!res) return;
  renderResultsPanel(res.pairs || []);
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

// Initial load
loadAndRender();
scheduleNextScan();

// Update scan status every 200ms
setInterval(updateScanStatus, 200);