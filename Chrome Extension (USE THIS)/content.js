
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

// Check if text is toxic using the classification endpoint
const classifyText = async (text) => {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: 'classifyText', text }, (response) => {
        if (!response) return reject('No response from background worker');
        if (response.success) {
          resolve(response.isToxic);
        } else {
          reject(response.error || 'Classification failed');
        }
      });
    } catch (err) {
      reject(err);
    }
  });
};

// Batch classify multiple texts
const classifyTexts = async (texts) => {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: 'classifyText', texts }, (response) => {
        if (!response) return reject('No response from background worker');
        if (response.success) {
          resolve(response.results);
        } else {
          reject(response.error || 'Classification failed');
        }
      });
    } catch (err) {
      reject(err);
    }
  });
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

    // Non-toxic items: highlight on page, but do not log for popup
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
        }
      } catch (err) {
        console.error('Error processing non-toxic text:', err);
      }
    });

    if (toxicItems.length > 0) {
      const toxicTexts = toxicItems.map(i => i.text);
      chrome.runtime.sendMessage({ type: 'detoxifyText', texts: toxicTexts }, (response) => {
        if (!response) {
          console.error('No response from background for batch');
          return;
        }
        if (!response.success) {
          console.error('Batch detox failed:', response.error);
          return;
        }

        const outputs = response.outputs || [];
        toxicItems.forEach((it, idx) => {
          const out = outputs[idx] && outputs[idx].length > 0 ? outputs[idx] : it.text;
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
                  original: it.text,
                  detoxified: out,
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
      });
    }
  } catch (err) {
    console.error('Error during batch classification:', err);
  }
}; // ← closes flushBatch function


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
        if (len < 20 || len > 1000) return NodeFilter.FILTER_REJECT;

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
});

let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    console.log("URL changed, rescanning...");
    scanBlockElements();
  }
}, 1000);