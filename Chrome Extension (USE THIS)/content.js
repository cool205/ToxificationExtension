
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

const detoxify = async text =>
  text.replace(/\b(hate|kill|stupid|idiot|ugly|trash)\b/gi, match =>
    replacements[match.toLowerCase()] || match
  );

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

  try {
    const detoxified = await detoxify(originalText);
    const span = document.createElement('span');
    span.textContent = detoxified;
    span.style.backgroundColor = '#ffffcc';

    const parent = nodes[0].parentNode;
    if (parent) {
      nodes.forEach(n => n.parentNode?.removeChild(n));
      parent.appendChild(span);
    }

    chrome.runtime.sendMessage({
      type: "logDetox",
      payload: {
        original: originalText,
        detoxified,
        timestamp: new Date().toISOString()
      }
    });
    detoxCount++;
    updateDetoxBadge(detoxCount);
  } catch (err) {
    console.error("❌ Detoxification failed:", err, item);
  }
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