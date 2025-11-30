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
  });
}

async function classifyTexts(texts) {
  const r = await sendBg({ type: "classifyText", texts });
  if (!r.success) throw new Error(r.error || "classification failed");
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
let processedHashes = new Set();
let requestIdCounter = 1;

const BATCH_DELAY = 100; // fast batching

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

function enqueue(nodes, text) {
  const parent = nodes[0]?.parentNode;
  if (!parent) return;
  if (parent.dataset.detoxified === "1") return;

  const h = hashString(text);
  if (processedHashes.has(h)) return;
  processedHashes.add(h);

  const id = requestIdCounter++;

  parent.dataset.textId = id;
  textElements.set(String(id), parent);

  sendBg({
    type: "logDetected",
    payload: {
      id,
      text,
      isToxic: null,
      timestamp: new Date().toISOString(),
    },
  });

  batchQueue.push({ id, nodes, text, parent });

  if (!batchTimer) {
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
        toxicItems.push(it);
      } else {
        cleanItems.push(it);
      }
    });

    // Non-toxic: mark as processed (do not apply visual styles here)
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
          timestamp: new Date().toISOString(),
        },
      });
    });

    if (toxicItems.length === 0) return;

    // Detoxify toxic items
    const toxTexts = toxicItems.map((i) => i.text);
    const { outputs = [], attempts = [], errors = [] } = await detoxifyTexts(toxTexts);

    toxicItems.forEach((it, index) => {
      let out = outputs[index] || it.text;
      // remove model prefixes like "detoxify: " if present
      out = String(out).replace(/^\s*detoxify:\s*/i, '');

      const span = document.createElement("span");
      span.textContent = out;
      // mark generated content as detoxified so scanner ignores it
      span.dataset.detoxified = "1";
      span.dataset.textId = it.id;

      it.nodes.forEach((n) => n.remove());
      it.parent.appendChild(span);

      it.parent.dataset.detoxified = "1";
      it.parent.dataset.textId = it.id;
      textElements.set(String(it.id), it.parent);

      sendBg({
        type: "logDetox",
        payload: {
          id: it.id,
          original: it.text,
          detoxified: out,
          attempts: attempts[index] || 0,
          error: errors[index] || null,
          timestamp: new Date().toISOString(),
        },
      });

      sendBg({
        type: "logDetected",
        payload: {
          id: it.id,
          text: it.text,
          isToxic: true,
          timestamp: new Date().toISOString(),
        },
      });

      totalDetoxified++;
      updateDetoxBadge(totalDetoxified);
    });
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
        const t = node.textContent.trim();
        if (!t) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p || !isVisible(p)) return NodeFilter.FILTER_REJECT;
        // skip content already marked as detoxified (prevent re-scanning/re-processing)
        try {
          if (p.closest && p.closest('[data-detoxified="1"]')) return NodeFilter.FILTER_REJECT;
        } catch (e) {
          /* ignore selector errors */
        }
        if (t.length < 10 || t.length > 1000) return NodeFilter.FILTER_REJECT;
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
      if (text.length >= 40) enqueue(textNodes, text);
      textNodes = [];
    }

    textNodes.push(n);
    lastParent = p;
  }

  if (textNodes.length > 0) {
    const text = textNodes.map((x) => x.textContent).join(" ").trim();
    if (text.length >= 40) enqueue(textNodes, text);
  }
}

const mo = new MutationObserver((mut) => {
  for (const m of mut) {
    for (const node of m.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }
  }
});
mo.observe(document.body, { childList: true, subtree: true });

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
        case "green":
          el.style.transition = "background-color 0.2s ease";
          el.style.backgroundColor = "#e6ffed";
          break;
        case "yellow":
          el.style.transition = "background-color 0.2s ease";
          el.style.backgroundColor = "#fff8e1";
          break;
                case "red":
          el.style.transition = "background-color 0.2s ease";
          el.style.backgroundColor = "#ffecec";
          break;
        case "brown":
          el.style.transition = "background-color 0.2s ease";
          el.style.backgroundColor = "#f3e6d6";
          break;
      }
    }
  }

  if (msg.type === "removeColor") {
    const el = textElements.get(String(msg.id));
    if (el) {
      el.style.backgroundColor = "";
    }
  }
});

// Initial scan on page load
scan();