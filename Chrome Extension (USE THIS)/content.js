
const createDetoxBadge = () => {
  if (document.getElementById('detoxBadge')) return;

  const badge = document.createElement('div');
  badge.id = 'detoxBadge';
  badge.style.position = 'fixed';
  badge.style.bottom = '20px';
  badge.style.right = '20px';
  badge.style.background = '#333';
  badge.style.color = '#fff';
  badge.style.padding = '8px 12px';
  badge.style.borderRadius = '6px';
  badge.style.fontSize = '14px';
  badge.style.zIndex = '9999';
  badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
  badge.style.opacity = '0';
  badge.style.transition = 'opacity 0.3s ease';

  badge.textContent = 'Detoxifying...';
  document.body.appendChild(badge);
};

const updateDetoxBadge = (count) => {
  const badge = document.getElementById('detoxBadge');
  if (!badge) return;

  badge.textContent = `Detoxified ${count} block${count === 1 ? '' : 's'}`;
  badge.style.opacity = '1';

  clearTimeout(badge._fadeTimeout);
  badge._fadeTimeout = setTimeout(() => {
    badge.style.opacity = '0';
  }, 3000);
};

const toxicKeywords = ["hate", "kill", "stupid", "idiot", "ugly", "trash"];
const replacements = {
  hate: "dislike",
  kill: "stop",
  stupid: "uninformed",
  idiot: "person",
  ugly: "unattractive",
  trash: "unwanted"
};

const tokenize = text =>
  text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);

const classify = text =>
  tokenize(text).some(token => toxicKeywords.includes(token)) ? "toxic" : "clean";

// Replace the keyword-based detoxify with a remote detoxifier call.
// This sends the full text to the background worker which queries the Space.
// Batching configuration
const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 800;

// Internal batching state
let batchQueue = [];
let batchTimer = null;
let requestIdCounter = 1;

// Prevent re-processing the same block
const markDetoxified = (el) => { if (el && el.dataset) el.dataset.detoxified = '1'; };
const isAlreadyDetoxified = (el) => el && el.dataset && el.dataset.detoxified === '1';

const flushBatch = () => {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  if (batchQueue.length === 0) return;

  const items = batchQueue.splice(0, batchQueue.length);
  const texts = items.map(i => i.text);

  chrome.runtime.sendMessage({ type: 'detoxifyText', texts }, (response) => {
    if (!response) {
      console.error('No response from background for batch');
      return;
    }
    if (!response.success) {
      console.error('Batch detox failed:', response.error);
      // On failure, we can optionally fallback to simple keyword replacement
    }

    const outputs = response.outputs || [];
    items.forEach((it, idx) => {
      const out = outputs[idx] && outputs[idx].length > 0 ? outputs[idx] : it.text;
      try {
        const span = document.createElement('span');
        span.textContent = out;
        span.style.backgroundColor = '#ffffcc';

        const parent = it.nodes[0] && it.nodes[0].parentNode;
        if (parent) {
          it.nodes.forEach(n => n.parentNode?.removeChild(n));
          parent.appendChild(span);
          markDetoxified(parent);

          chrome.runtime.sendMessage({
            type: "logDetox",
            payload: {
              original: it.text,
              detoxified: out,
              timestamp: new Date().toISOString()
            }
          });
          updateDetoxBadge(1);
        }
      } catch (err) {
        console.error('Error applying detoxified text for item', it, err);
      }
    });
  });
};

const enqueueForDetox = (nodes, text) => {
  // Skip if parent block already detoxified
  const parent = nodes[0] && nodes[0].parentNode;
  if (isAlreadyDetoxified(parent)) return;

  const id = requestIdCounter++;
  batchQueue.push({ id, nodes, text });

  if (batchQueue.length >= BATCH_SIZE) {
    flushBatch();
  } else {
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(() => flushBatch(), BATCH_DELAY_MS);
  }
};

const isVisible = el => {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  return (
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    style.opacity !== '0' &&
    parseFloat(style.fontSize) > 0
  );
};

const scanBlockElements = (root = document.body) => {
  let detoxCount = 0;
  createDetoxBadge();
  console.log("🔁 Rescanning block elements...");
  const blocks = root.querySelectorAll('div, p, li, article, section, td, th');

  blocks.forEach(block => {
    if (!isVisible(block)) return;

    const textNodes = [];
    const walker = document.createTreeWalker(
      block,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: node =>
          node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      if (isVisible(node.parentElement)) textNodes.push(node);
    }

    if (textNodes.length === 0) return;

    const combinedText = textNodes.map(n => n.nodeValue).join(' ').trim();
    if (combinedText.length < 10 || combinedText.length > 1000) return;

    const item = { nodes: textNodes, originalText: combinedText };
    processTextBlock(item);
  });
};

const processTextBlock = async (item) => {
  const { originalText, nodes } = item;
  const label = classify(originalText);
  if (label !== "toxic") return;

    // enqueue for batched detoxification
    enqueueForDetox(nodes, originalText);
};

scanBlockElements();

new MutationObserver(mutations => {
  const hasNewContent = mutations.some(({ addedNodes }) =>
    Array.from(addedNodes).some(node => node.nodeType === Node.ELEMENT_NODE)
  );
  if (hasNewContent) scanBlockElements();
}).observe(document.body, { childList: true, subtree: true });

const intersectionObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) scanBlockElements(entry.target);
  });
});
document.querySelectorAll('*').forEach(el => intersectionObserver.observe(el));

let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    console.log("🔄 URL changed, rescanning...");
    scanBlockElements();
  }
}, 1000);