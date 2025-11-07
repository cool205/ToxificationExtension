
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

// Helper to send messages to background with retries and exponential backoff
const sendBgMessageWithRetry = async (msg, maxAttempts = 3, baseDelay = 1000) => {
  // If we have a persistent port, prefer posting to it for lower chance of 'no response'
  const tryPostToPort = () => {
    try {
      // attempt to post to any connected port
      for (const [, port] of window.__connectedPorts || []) {
        try {
          port.postMessage(msg);
        } catch (err) {
          // ignore
        }
      }
    } catch (e) {
      // ignore
    }
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await new Promise((resolve) => {
        let called = false;
        chrome.runtime.sendMessage(msg, (response) => {
          called = true;
          // Check runtime.lastError too
          if (chrome.runtime.lastError) {
            // pass the error string as undefined result so outer retry handles it
            resolve({ __error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response);
        });

        // In case callback never fires (service worker killed), set a timeout to resolve undefined
        setTimeout(() => {
          if (!called) resolve(undefined);
        }, baseDelay * 2);
      });

      // handle explicit runtime.lastError wrapper
      if (res && res.__error) {
        // if extension context invalidated, retry after a short backoff
        if (String(res.__error).includes('Extension context invalidated')) {
          if (attempt < maxAttempts) await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt - 1)));
          continue;
        }
        // otherwise return as failure
        return { success: false, error: res.__error };
      }

      if (!res) {
        // try posting to ports as fallback
        tryPostToPort();
        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt - 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (String(err).includes('Extension context invalidated')) {
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt - 1)));
          continue;
        }
      }
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt - 1)));
      else throw err;
    }
  }
  return undefined;
};

// Create a persistent port to background to help keep service worker alive
let keepAlivePort = null;
try {
  keepAlivePort = chrome.runtime.connect({ name: 'keepAlive' });
  // store minimal reference for port-based fallback
  if (!window.__connectedPorts) window.__connectedPorts = [];
  window.__connectedPorts.push(['keepAlive', keepAlivePort]);
  // ping periodically
  setInterval(() => {
    try { keepAlivePort.postMessage({ type: 'keepAlivePing' }); } catch (e) { /* ignore */ }
  }, 28000);
  keepAlivePort.onMessage.addListener((m) => {
    // optional: handle keepAlivePong
    if (m && m.type === 'keepAlivePong') return;
  });
} catch (err) {
  // connecting can fail in some environments, ignore
}

// Check if text is toxic using the classification endpoint
const classifyText = async (text) => {
  // Use the background retry wrapper for single-item classification as well
  const response = await sendBgMessageWithRetry({ type: 'classifyText', text }, 3, 3000);
  if (!response) throw new Error('No response from background worker');
  if (response.success) return response.isToxic;
  throw new Error(response.error || 'Classification failed');
};

// Batch classify multiple texts
const classifyTexts = async (texts) => {
  try {
  const response = await sendBgMessageWithRetry({ type: 'classifyText', texts }, 3, 3000);
    if (!response) throw new Error('No response from background worker after retries');
    if (response.success) return response.results;
    throw new Error(response.error || 'Classification failed');
  } catch (err) {
    throw err;
  }
};

// Replace the keyword-based detoxify with a remote detoxifier call.
// This sends the full text to the background worker which queries the Space.
// Batching configuration
const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 800;

// Internal batching state
let batchQueue = [];
let batchTimer = null;
let requestIdCounter = 1;
// Total count across page lifetime
let totalDetoxified = 0;

// Track processed text hashes to avoid subtle duplicates
const processedHashes = new Set();

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

// Results panel UI (green = captured but unchanged, red = changed before/after)
const createResultsPanel = () => {
  if (document.getElementById('detox-results-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'detox-results-panel';
  panel.style.position = 'fixed';
  panel.style.left = '12px';
  panel.style.bottom = '12px';
  panel.style.width = '360px';
  panel.style.maxHeight = '48vh';
  panel.style.overflow = 'auto';
  panel.style.background = 'rgba(255,255,255,0.95)';
  panel.style.border = '1px solid rgba(0,0,0,0.12)';
  panel.style.borderRadius = '8px';
  panel.style.padding = '8px';
  panel.style.zIndex = '10000';
  panel.style.fontSize = '12px';
  panel.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';

  const title = document.createElement('div');
  title.textContent = 'Detox Results';
  title.style.fontWeight = '600';
  title.style.marginBottom = '6px';
  panel.appendChild(title);

  const lists = document.createElement('div');
  lists.style.display = 'flex';
  lists.style.gap = '8px';

  const capturedCol = document.createElement('div');
  capturedCol.style.flex = '1';
  const capHeader = document.createElement('div');
  capHeader.textContent = 'Captured (unchanged)';
  capHeader.style.background = '#e6ffed';
  capHeader.style.padding = '4px';
  capHeader.style.borderRadius = '4px';
  capHeader.style.marginBottom = '4px';
  capturedCol.appendChild(capHeader);
  const capList = document.createElement('div');
  capList.id = 'detox-captured-list';
  capList.style.display = 'flex';
  capList.style.flexDirection = 'column';
  capList.style.gap = '6px';
  capturedCol.appendChild(capList);

  const changedCol = document.createElement('div');
  changedCol.style.flex = '1';
  const chHeader = document.createElement('div');
  chHeader.textContent = 'Changed (before → after)';
  chHeader.style.background = '#ffecec';
  chHeader.style.padding = '4px';
  chHeader.style.borderRadius = '4px';
  chHeader.style.marginBottom = '4px';
  changedCol.appendChild(chHeader);
  const chList = document.createElement('div');
  chList.id = 'detox-changed-list';
  chList.style.display = 'flex';
  chList.style.flexDirection = 'column';
  chList.style.gap = '6px';
  changedCol.appendChild(chList);

  lists.appendChild(capturedCol);
  lists.appendChild(changedCol);
  panel.appendChild(lists);

  document.body.appendChild(panel);
};

const addCapturedEntry = (text) => {
  createResultsPanel();
  const list = document.getElementById('detox-captured-list');
  if (!list) return;
  const item = document.createElement('div');
  item.style.background = '#e6ffed';
  item.style.padding = '6px';
  item.style.borderRadius = '4px';
  item.style.wordBreak = 'break-word';
  item.textContent = text;
  list.prepend(item);
};

const addChangedEntry = (original, changed) => {
  createResultsPanel();
  const list = document.getElementById('detox-changed-list');
  if (!list) return;
  const item = document.createElement('div');
  item.style.background = '#fff0f0';
  item.style.padding = '6px';
  item.style.borderRadius = '4px';
  item.style.wordBreak = 'break-word';

  const before = document.createElement('div');
  before.style.textDecoration = 'line-through';
  before.style.color = '#8b0000';
  before.textContent = original;

  const after = document.createElement('div');
  after.style.marginTop = '4px';
  after.style.color = '#006400';
  after.textContent = changed;

  item.appendChild(before);
  item.appendChild(after);
  list.prepend(item);
};

// Tracking and error prevention
let processingError = false;
let textElements = new Map(); // Store references to processed elements

// Prevent re-processing the same block and track elements
const markDetoxified = (el, id) => { 
  if (el?.dataset) {
    el.dataset.detoxified = '1';
    el.dataset.textId = String(id);
    textElements.set(String(id), el);
  }
};

const isAlreadyDetoxified = (el) => el?.dataset?.detoxified === '1';

// Highlight support
const highlight = (el) => {
  if (!el) return;
  el.style.outline = '2px solid #0366d6';
  el.style.boxShadow = '0 0 10px rgba(3, 102, 214, 0.3)';
};

const removeHighlight = (el) => {
  if (!el) return;
  el.style.outline = '';
  el.style.boxShadow = '';
};

const flushBatch = async () => {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  if (batchQueue.length === 0) return;

  const items = batchQueue.splice(0, batchQueue.length);
  const texts = items.map(i => i.text);

  try {
    const toxicResults = await classifyTexts(texts);

    const toxicItems = items.filter((_, idx) => toxicResults[idx]);
    const nonToxicItems = items.filter((_, idx) => !toxicResults[idx]);

    // Non-toxic items: highlight on page, and log for popup
    nonToxicItems.forEach(it => {
      try {
        const span = document.createElement('span');
        span.textContent = it.text;
        span.style.backgroundColor = '#e6ffed';

        const parent = it.nodes[0] && it.nodes[0].parentNode;
        if (parent) {
          it.nodes.forEach(n => n.parentNode?.removeChild(n));
          parent.appendChild(span);
          markDetoxified(parent);

          // Log non-toxic block for popup dropdown
          chrome.runtime.sendMessage({
            type: "logDetected",
            payload: {
              text: it.text,
              isToxic: false,
              timestamp: new Date().toISOString()
            }
          });
          addCapturedEntry(it.text);
        }
      } catch (err) {
        console.error('Error processing non-toxic text:', err);
      }
    });

    if (toxicItems.length > 0) {
      const toxicTexts = toxicItems.map(i => i.text);
      try {
  const response = await sendBgMessageWithRetry({ type: 'detoxifyText', texts: toxicTexts }, 3, 3000);
        if (!response) {
          console.error('No response from background for batch');
          return;
        }
        if (!response.success) {
          console.error('Batch detox failed:', response.error);
          return;
        }

        const outputs = response.outputs || [];
        const attemptsArr = response.attempts || [];
        const errorsArr = response.errors || [];
        toxicItems.forEach((it, idx) => {
          const out = outputs[idx] && outputs[idx].length > 0 ? outputs[idx] : it.text;
          const attempts = attemptsArr[idx] || 0;
          const error = errorsArr[idx] || null;
          try {
            const span = document.createElement('span');
            span.textContent = out;
            span.style.backgroundColor = '#ffecec';

            const parent = it.nodes[0] && it.nodes[0].parentNode;
            if (parent) {
              it.nodes.forEach(n => n.parentNode?.removeChild(n));
              parent.appendChild(span);
              markDetoxified(parent);

              chrome.runtime.sendMessage({
                type: "logDetox",
                payload: {
                  id: it.id,
                  original: it.text,
                  detoxified: out,
                  attempts,
                  error,
                  timestamp: new Date().toISOString()
                }
              });
              // Also log as detected (toxic) for dropdown
              chrome.runtime.sendMessage({
                type: "logDetected",
                payload: {
                  text: it.text,
                  isToxic: true,
                  timestamp: new Date().toISOString()
                }
              });
              totalDetoxified += 1;
              updateDetoxBadge(totalDetoxified);
              addChangedEntry(it.text, out);
            }
          } catch (err) {
            console.error('Error applying detoxified text for item', it, err);
          }
        });
      } catch (err) {
        console.error('Error calling detoxifyText (sendBgMessageWithRetry):', err);
      }
    }
  } catch (err) {
    console.error('Error during batch classification:', err);
  }
}; // ← closes flushBatch function


const enqueueForDetox = (nodes, text) => {
  const parent = nodes[0] && nodes[0].parentNode;
  if (isAlreadyDetoxified(parent)) return;

  const id = requestIdCounter++;
  batchQueue.push({ id, nodes, text });

  flushBatch(); // ← flush immediately
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
  createDetoxBadge();
  console.log("Scanning for text blocks...");
  
  // Get all text-containing elements
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: node => {
        const text = node.textContent.trim();
        if (!text) return NodeFilter.FILTER_REJECT;
        
        // Check parent visibility
        const parent = node.parentElement;
        if (!parent || !isVisible(parent)) return NodeFilter.FILTER_REJECT;

        // Only filter by length
        const len = text.length;
        if (len < 15 || len > 1000) return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  // Group nearby text nodes together
  const textGroups = new Map();
  let currentGroup = [];
  let lastParent = null;
  
  let node;
  while (node = walker.nextNode()) {
    const parent = node.parentElement;
    
    // Start new group if parent changed
    if (parent !== lastParent && currentGroup.length > 0) {
      const text = currentGroup.map(n => n.textContent).join(' ').trim();
      if (text.length >= 40 && text.length <= 1000) {
        textGroups.set(lastParent, currentGroup.slice());
      }
      currentGroup = [];
    }
    
    currentGroup.push(node);
    lastParent = parent;
  }
  
  // Process last group
  if (currentGroup.length > 0 && lastParent) {
    const text = currentGroup.map(n => n.textContent).join(' ').trim();
    if (text.length >= 40 && text.length <= 1000) {
      textGroups.set(lastParent, currentGroup.slice());
    }
  }

  // Process all groups
  textGroups.forEach((nodes, parent) => {
    if (!isAlreadyDetoxified(parent)) {
      const text = nodes.map(n => n.textContent).join(' ').trim();
      // dedupe by hash to avoid subtle duplicates across similar blocks
      const h = hashString(text);
      if (processedHashes.has(h)) return;
      processedHashes.add(h);
      processTextBlock({ nodes, originalText: text });
    }
  });
};

const processTextBlock = async (item) => {
  const { originalText, nodes } = item;
  // All blocks are now sent for classification in batches
  enqueueForDetox(nodes, originalText);
};

scanBlockElements();

new MutationObserver(mutations => {
  const hasNewContent = mutations.some(({ addedNodes }) =>
    Array.from(addedNodes).some(node => node.nodeType === Node.ELEMENT_NODE)
  );
  if (hasNewContent) scanBlockElements();
}).observe(document.body, { childList: true, subtree: true });

// Re-observe newly added elements so IntersectionObserver watches them too
const mutationObserver = new MutationObserver(mutations => {
  for (const m of mutations) {
    for (const node of Array.from(m.addedNodes || [])) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      try {
        // observe new element and its children
        intersectionObserver.observe(node);
        node.querySelectorAll && node.querySelectorAll('*').forEach(el => intersectionObserver.observe(el));
      } catch (err) {
        // ignore
      }
    }
  }
});
mutationObserver.observe(document.body, { childList: true, subtree: true });

const intersectionObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) scanBlockElements(entry.target);
  });
});
document.querySelectorAll('*').forEach(el => intersectionObserver.observe(el));

// Listen for highlight commands from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'highlightText') {
    const el = textElements.get(String(message.id));
    if (el) highlight(el);
  }
  else if (message.type === 'removeHighlight') {
    textElements.forEach(el => removeHighlight(el));
  }
  else if (message.type === 'triggerRescan') {
    // Force a rescan of the current document and enqueue texts for classification
    try {
      scanBlockElements();
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ success: false, error: String(err) });
    }
    return true;
  }
});

let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    console.log("URL changed, rescanning...");
    scanBlockElements();
  }
}, 1000);

// Flush batch and clear timers on unload/navigation to avoid dangling async work
window.addEventListener('beforeunload', () => {
  try {
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    if (batchQueue.length > 0) {
      // attempt a final flush synchronously is not possible; clear queue
      batchQueue.length = 0;
    }
  } catch (err) {
    console.warn('beforeunload cleanup failed', err);
  }
});

// Also handle visibilitychange to cancel/flush when user navigates away
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
  }
});