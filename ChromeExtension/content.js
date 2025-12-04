const createDetoxBadge = () => {
  if (document.getElementById("detoxBadge")) return;

  const badge = document.createElement("div");
  badge.id = "detoxBadge";
  Object.assign(badge.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    background: "#333",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: "6px",
    fontSize: "14px",
    zIndex: "999999",
    boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
    opacity: "0",
    transition: "opacity 0.3s ease",
  });

  badge.textContent = "Detoxifying...";
  document.body.appendChild(badge);
};

const updateDetoxBadge = (count) => {
  const badge = document.getElementById("detoxBadge");
  if (!badge) return;

  badge.textContent = `Detoxified ${count} block${count === 1 ? "" : "s"}`;
  badge.style.opacity = "1";

  clearTimeout(badge._fadeTimeout);
  badge._fadeTimeout = setTimeout(() => (badge.style.opacity = "0"), 3000);
};

async function sendBg(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        resolve(response || { success: false, error: "No response" });
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

async function classifyTexts(texts) {
  const r = await sendBg({ type: "classifyText", texts });
  if (!r.success) {
    if (r.error.includes("context invalidated")) {
      // Retry once after a short delay
      await new Promise(res => setTimeout(res, 500));
      return classifyTexts(texts);
    }
    throw new Error(r.error || "classification failed");
  }
  return r.results;
}

async function detoxifyTexts(texts) {
  const r = await sendBg({ type: "detoxifyText", texts });
  if (!r.success) throw new Error(r.error || "detoxify failed");
  return r;
}

let batchQueue = [];
let batchTimer = null;
let totalDetoxified = 0;
let textElements = new Map();
// use a Map for processed hashes so we can cap and evict old entries
let processedHashes = new Map();
let requestIdCounter = 1;

// runtime-configurable parameters (will be updated from storage)
let BATCH_DELAY = 50; // default (ms)
let MAX_BATCH_SIZE = 16; // default
let MIN_GROUP_CHARS = 30; // minimum chars in grouped text to enqueue
let MIN_NODE_CHARS = 3; // minimum chars for an individual text node to be considered
let MUTATION_DEBOUNCE_MS = 60; // debounce mutations
let PROCESSED_HASH_CAP = 10000; // cap for processedHashes
let USE_REQUEST_IDLE = true; // prefer requestIdleCallback for background work
let BLOCK_MODE = 'colormatch'; // 'colormatch' | 'blur' | 'remove'

// mutation batching
const mutationQueue = new Set();
let mutationTimer = null;

// load settings from storage if available
try {
  chrome.storage.local.get(['extSettings'], (res) => {
    const s = res?.extSettings || {};
    if (s.BATCH_DELAY != null) BATCH_DELAY = Number(s.BATCH_DELAY);
    if (s.MAX_BATCH_SIZE != null) MAX_BATCH_SIZE = Number(s.MAX_BATCH_SIZE);
    if (s.MIN_GROUP_CHARS != null) MIN_GROUP_CHARS = Number(s.MIN_GROUP_CHARS);
    if (s.MIN_NODE_CHARS != null) MIN_NODE_CHARS = Number(s.MIN_NODE_CHARS);
    if (s.MUTATION_DEBOUNCE_MS != null) MUTATION_DEBOUNCE_MS = Number(s.MUTATION_DEBOUNCE_MS);
    if (s.PROCESSED_HASH_CAP != null) PROCESSED_HASH_CAP = Number(s.PROCESSED_HASH_CAP);
    if (s.USE_REQUEST_IDLE != null) USE_REQUEST_IDLE = !!s.USE_REQUEST_IDLE;
    if (s.BLOCK_MODE) BLOCK_MODE = String(s.BLOCK_MODE);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.extSettings && changes.extSettings.newValue) {
      const s = changes.extSettings.newValue;
      if (s.BATCH_DELAY != null) BATCH_DELAY = Number(s.BATCH_DELAY);
      if (s.MAX_BATCH_SIZE != null) MAX_BATCH_SIZE = Number(s.MAX_BATCH_SIZE);
      if (s.MIN_GROUP_CHARS != null) MIN_GROUP_CHARS = Number(s.MIN_GROUP_CHARS);
      if (s.MIN_NODE_CHARS != null) MIN_NODE_CHARS = Number(s.MIN_NODE_CHARS);
      if (s.MUTATION_DEBOUNCE_MS != null) MUTATION_DEBOUNCE_MS = Number(s.MUTATION_DEBOUNCE_MS);
      if (s.PROCESSED_HASH_CAP != null) PROCESSED_HASH_CAP = Number(s.PROCESSED_HASH_CAP);
      if (s.USE_REQUEST_IDLE != null) USE_REQUEST_IDLE = !!s.USE_REQUEST_IDLE;
      if (s.BLOCK_MODE) BLOCK_MODE = String(s.BLOCK_MODE);
    }
  });
} catch (e) {
  /* ignore if storage not available */
}

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

function normalizeForCompare(s) {
  if (s == null) return '';
  // Remove common prefixes like 'detoxify:' and normalize whitespace/punctuation/case
  let t = String(s).replace(/^\s*detoxify:\s*/i, '');
  // Normalize HTML entities if any (basic common ones)
  t = t.replace(/&nbsp;/gi, ' ');
  // Remove punctuation (keep word characters and spaces), collapse whitespace, lowercase
  t = t.replace(/[\W_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return t;
}

function enqueue(nodes, text) {
  const parent = nodes[0]?.parentNode;
  if (!parent) return;
  if (parent.dataset.detoxified === "1") return;

  const h = hashString(text);
  if (processedHashes.has(h)) return;
  // mark processed and cap the map size
  processedHashes.set(h, Date.now());
  if (processedHashes.size > PROCESSED_HASH_CAP) {
    // evict oldest
    let oldestKey = null;
    let oldestTs = Infinity;
    for (const [k, ts] of processedHashes.entries()) {
      if (ts < oldestTs) { oldestTs = ts; oldestKey = k; }
    }
    if (oldestKey) processedHashes.delete(oldestKey);
  }

  const id = requestIdCounter++;

  parent.dataset.textId = id;
  textElements.set(String(id), parent);

  sendBg({
    type: "logDetected",
    payload: {
      id,
      text,
      isToxic: null,
      toxicPercentage: null,
      timestamp: new Date().toISOString(),
    },
  });

  batchQueue.push({ id, nodes, text, parent });

  // If batch grew large, flush immediately to reduce latency, otherwise schedule
  if (batchQueue.length >= MAX_BATCH_SIZE) {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    flushBatch();
  } else if (!batchTimer) {
    batchTimer = setTimeout(flushBatch, BATCH_DELAY);
  }
}

async function flushBatch() {
  clearTimeout(batchTimer);
  batchTimer = null;

  if (batchQueue.length === 0) return;

  const items = batchQueue.splice(0, batchQueue.length);
  const texts = items.map((i) => i.text);

  try {
    const toxicFlags = await classifyTexts(texts);

    const toxicItems = [];
    const cleanItems = [];

    items.forEach((it, i) => {
      const flag = toxicFlags[i];
      if (flag && flag.success && flag.isToxic) {
        // Store the flag with the item for later use
        it.classificationFlag = flag;
        toxicItems.push(it);
      } else {
        cleanItems.push(it);
      }
    });

    // Non-toxic: mark as processed
    cleanItems.forEach((it) => {
      it.parent.dataset.detoxified = "1";
      it.parent.dataset.textId = it.id;
      textElements.set(String(it.id), it.parent);

      sendBg({
        type: "logDetected",
        payload: {
          id: it.id,
          text: it.text,
          isToxic: false,
          toxicPercentage: null,
          timestamp: new Date().toISOString(),
        },
      });
    });

    if (toxicItems.length > 0) {
      const toxTexts = toxicItems.map((i) => i.text);
      const { outputs = [], attempts = [], errors = [] } = await detoxifyTexts(toxTexts);

      toxicItems.forEach((it, index) => {
        let out = outputs[index] || it.text;
        out = String(out).replace(/^\s*detoxify:\s*/i, "");
        // If detoxified output equals original (no change), mark as blocked visually
        const origTrim = String(it.text || '').trim();
        const outTrim = String(out || '').trim();
        // Compare normalized forms so small differences (punctuation, case, whitespace)
        // won't prevent detection of identical outputs.
        const normOrig = normalizeForCompare(origTrim);
        const normOut = normalizeForCompare(outTrim);
        if (normOut === normOrig) {
          // Create blocked element according to BLOCK_MODE
          const span = document.createElement("span");
          span.dataset.detoxified = "1";
          span.dataset.blocked = "1";
          span.dataset.textId = it.id;
          span.dataset.original = it.text;

          if (BLOCK_MODE === 'remove') {
            span.textContent = '[Blocked content]';
            span.setAttribute('aria-hidden', 'true');
          } else if (BLOCK_MODE === 'blur') {
            span.textContent = out;
            span.style.filter = 'blur(6px)';
            span.style.pointerEvents = 'none';
            span.setAttribute('aria-hidden', 'true');
          } else {
            // default: color-match to parent background to make unreadable
            span.textContent = out;
            try {
              const bg = (it.parent && window.getComputedStyle(it.parent).backgroundColor) || window.getComputedStyle(document.body).backgroundColor || '#fff';
              const bgIsTransparent = /^rgba\(0,\s*0,\s*0,\s*0\)/i.test(String(bg)) || bg === 'transparent';
              span.style.color = bgIsTransparent ? '#fff' : bg;
              span.style.userSelect = 'none';
              span.setAttribute('aria-hidden', 'true');
            } catch (e) {}
          }

          const firstNode = it.nodes && it.nodes[0];
          if (firstNode && firstNode.parentNode) {
            firstNode.parentNode.insertBefore(span, firstNode);
          } else {
            it.parent.appendChild(span);
          }
          it.nodes.forEach((n) => n.remove());
          it.parent.dataset.detoxified = "1";
          it.parent.dataset.textId = it.id;
          textElements.set(String(it.id), it.parent);

          sendBg({
            type: "logDetox",
            payload: {
              id: it.id,
              original: it.text,
              detoxified: out,
              blocked: true,
              attempts: attempts[index] || 0,
              error: errors[index] || null,
              timestamp: new Date().toISOString(),
            },
          });
        } else {
          // Debug: log mismatch between original and detoxified when not blocked
          try {
            console.debug('[detox-block-check] NO BLOCK:', {
              id: it.id,
              original: origTrim,
              detoxified: outTrim,
              normOriginal: normOrig,
              normDetox: normOut,
              origLen: origTrim.length,
              outLen: outTrim.length
            });
          } catch (e) {}
          const span = document.createElement("span");
          span.textContent = out;
          span.dataset.detoxified = "1";
          span.dataset.textId = it.id;

          const firstNode = it.nodes && it.nodes[0];
          if (firstNode && firstNode.parentNode) {
            firstNode.parentNode.insertBefore(span, firstNode);
          } else {
            it.parent.appendChild(span);
          }

          it.nodes.forEach((n) => n.remove());

          it.parent.dataset.detoxified = "1";
          it.parent.dataset.textId = it.id;
          textElements.set(String(it.id), it.parent);

          sendBg({
            type: "logDetox",
            payload: {
              id: it.id,
              original: it.text,
              detoxified: out,
              blocked: false,
              attempts: attempts[index] || 0,
              error: errors[index] || null,
              timestamp: new Date().toISOString(),
            },
          });
        }

        sendBg({
          type: "logDetected",
          payload: {
            id: it.id,
            text: it.text,
            isToxic: true,
            toxicPercentage: (it.classificationFlag && it.classificationFlag.toxicPercentage) ?? null,
            timestamp: new Date().toISOString(),
          },
        });

        totalDetoxified++;
        updateDetoxBadge(totalDetoxified);
      });
    }

    // If more items queued, schedule next flush
    if (batchQueue.length >= MAX_BATCH_SIZE) {
      setTimeout(flushBatch, 0); // async re-entry
    } else if (batchQueue.length > 0 && !batchTimer) {
      batchTimer = setTimeout(flushBatch, BATCH_DELAY);
    }
  } catch (err) {
    console.error("Batch failed:", err);
  }
}

const isVisible = (el) => {
  if (!el) return false;
  const s = getComputedStyle(el);
  return (
    s.display !== "none" &&
    s.visibility !== "hidden" &&
    s.opacity !== "0" &&
    parseFloat(s.fontSize) > 0
  );
};

function scan(root = document.body) {
  createDetoxBadge();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // fast checks: small trim and length checks
      const txt = node.textContent;
      if (!txt) return NodeFilter.FILTER_REJECT;
      const trimmed = txt.trim();
      if (!trimmed) return NodeFilter.FILTER_REJECT;
      if (trimmed.length < MIN_NODE_CHARS || trimmed.length > 2000) return NodeFilter.FILTER_REJECT;
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      try {
        if (p.closest && p.closest('[data-detoxified="1"]')) return NodeFilter.FILTER_REJECT;
      } catch (e) {}
      if (!isVisible(p)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let textNodes = [];
  let lastParent = null;

  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentElement;

    if (p !== lastParent && textNodes.length > 0) {
      const text = textNodes.map((x) => x.textContent).join(" ").trim();
      if (text.length >= MIN_GROUP_CHARS) enqueue(textNodes, text);
      textNodes = [];
    }

    textNodes.push(n);
    lastParent = p;
  }

  if (textNodes.length > 0) {
    const text = textNodes.map((x) => x.textContent).join(" ").trim();
    if (text.length >= MIN_GROUP_CHARS) enqueue(textNodes, text);
  }
}

const mo = new MutationObserver((mut) => {
  for (const m of mut) {
    for (const node of m.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        mutationQueue.add(node);
      }
    }
  }
  if (mutationTimer) clearTimeout(mutationTimer);
  mutationTimer = setTimeout(processMutationQueue, MUTATION_DEBOUNCE_MS);
});
mo.observe(document.body, { childList: true, subtree: true });

function processMutationQueue() {
  mutationTimer = null;
  if (mutationQueue.size === 0) return;
  const roots = Array.from(mutationQueue);
  mutationQueue.clear();
  const work = () => {
    for (const r of roots) {
      try { scan(r); } catch (e) {}
    }
  };
  if (USE_REQUEST_IDLE && typeof requestIdleCallback === 'function') requestIdleCallback(work, { timeout: 100 });
  else setTimeout(work, 0);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "highlightText") {
    const el = textElements.get(String(msg.id));
    if (el) {
      el.style.outline = "2px solid #0366d6";
      el.style.boxShadow = "0 0 10px rgba(3,102,214,0.3)";
    }
  }

  if (msg.type === "removeHighlight") {
    textElements.forEach((el) => {
      el.style.outline = "";
      el.style.boxShadow = "";
    });
  }

  if (msg.type === "triggerRescan") {
    scan();
    sendResponse({ success: true });
  }

  if (msg.type === "applyColor") {
    const el = textElements.get(String(msg.id));
    if (el) {
      switch (msg.status) {
        case "non-toxic":
          el.style.transition = "background-color 0.2s ease";
          el.style.backgroundColor = "#e6ffed";
          break;
        case "unclassified":
          el.style.transition = "background-color 0.2s ease";
          el.style.backgroundColor = "#fff8e1";
          break;
        case "toxic":
          el.style.transition = "background-color 0.2s ease";
          el.style.backgroundColor = "#ffecec";
          break;
        case "blocked":
          try {
            // Prefer applying to the inserted detox span if present
            const span = el.querySelector(`[data-text-id="${msg.id}"]`);
            const target = span || el;
            const bg = (el && window.getComputedStyle(el).backgroundColor) || window.getComputedStyle(document.body).backgroundColor || '#fff';
            const bgIsTransparent = /^rgba\(0,\s*0,\s*0,\s*0\)/i.test(String(bg)) || bg === 'transparent';
            target.style.color = bgIsTransparent ? '#fff' : bg;
            target.style.userSelect = 'none';
            try { target.dataset.blocked = '1'; } catch (e) {}
          } catch (e) {}
          break;
        case "ungenerated":
          el.style.transition = "background-color 0.2s ease";
          el.style.backgroundColor = "#f3e6d6";
          break;
      }
      try { el.dataset.highlighted = "1"; } catch (e) {}
    }
  }

  if (msg.type === "removeColor") {
    const el = textElements.get(String(msg.id));
    if (el) {
      el.style.backgroundColor = "";
      try {
        // remove color and blocked markers if present
        const span = el.querySelector(`[data-text-id="${msg.id}"]`);
        const target = span || el;
        target.style.color = "";
        try { target.removeAttribute('data-blocked'); } catch (e) {}
      } catch (e) {}
      try { el.removeAttribute('data-highlighted'); } catch (e) {}
    }
  }

  if (msg.type === 'checkHighlights') {
    try {
      let any = false;
      textElements.forEach((el) => {
        if (el && el.dataset && el.dataset.highlighted === '1') any = true;
      });
      sendResponse && sendResponse({ hasHighlights: any });
    } catch (e) {
      sendResponse && sendResponse({ hasHighlights: false });
    }
    return true;
  }
});

// Initial scan on page load
scan();
// schedule quick re-scans to catch dynamic content loading (e.g., Gmail)
setTimeout(() => { try { scan(); } catch (e) {} }, 300);
setTimeout(() => { try { scan(); } catch (e) {} }, 1500);

// Retry scanning when page becomes visible or gains focus
try {
  window.addEventListener('DOMContentLoaded', () => { scan(); });
  window.addEventListener('load', () => { scan(); });
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scan(); });
  window.addEventListener('focus', () => { scan(); });
  window.addEventListener('pageshow', () => { scan(); });
} catch (e) {}