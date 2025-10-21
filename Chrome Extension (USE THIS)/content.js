// === Classifier + Detoxifier Logic ===
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(token => token.length > 0);
}

function classify(text) {
  const toxicKeywords = ["hate", "kill", "stupid", "idiot", "ugly", "trash"];
  const tokens = tokenize(text);
  return tokens.some(token => toxicKeywords.includes(token)) ? "toxic" : "clean";
}

async function detoxify(text) {
  const replacements = {
    hate: "dislike",
    kill: "stop",
    stupid: "uninformed",
    idiot: "person",
    ugly: "unattractive",
    trash: "unwanted"
  };

  const detoxified = text.replace(/\b(hate|kill|stupid|idiot|ugly|trash)\b/gi, (match) => {
    return replacements[match.toLowerCase()] || match;
  });

  return `${detoxified}`;
}

// === Text Scanning Logic ===
const textNodeList = [];

console.log("Content script loaded");

function isVisible(node) {
  const parent = node.parentNode;
  if (!parent || !(parent instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(parent);
  return style && style.visibility !== 'hidden' && style.display !== 'none';
}

function scanText(root = document.body) {
  console.log("Scanning:", root);
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
    false
  );

  let node;
  while ((node = walker.nextNode())) {
    if (
      isVisible(node) &&
      !textNodeList.some(item => item.node === node)
    ) {
      console.log("Found text node:", node.nodeValue); // ✅ This is what you want
      const item = { node, originalText: node.nodeValue };
      textNodeList.push(item);
      processTextNode(item);
    }
  }
}

async function processTextNode(item) {
  const { node, originalText } = item;

  if (originalText.length > 1000) return; // Skip overly long text

  const label = classify(originalText);
  console.log("Label:", label);

  if (label === "toxic") {
    try {
      const detoxified = await detoxify(originalText);
      console.log("Detoxified:", detoxified);

      const span = document.createElement('span');
      span.textContent = detoxified;
      span.style.backgroundColor = '#ffffcc'; // Optional highlight

      const parent = node.parentNode;
      if (parent) {
        parent.replaceChild(span, node);
      }

      chrome.storage.local.get({ detoxLog: [] }, (data) => {
        const updatedLog = data.detoxLog;
        updatedLog.push({
          original: originalText,
          detoxified: detoxified
        });
        chrome.storage.local.set({ detoxLog: updatedLog });
      });
    } catch (err) {
      console.error("Detoxification failed:", err);
    }
  }
}

// === Initial Scan ===
scanText(document.body);

// === MutationObserver for dynamic content ===
const mutationObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        scanText(node);
      }
    });
  });
});

mutationObserver.observe(document.body, {
  childList: true,
  subtree: true
});

// === IntersectionObserver for lazy-loaded elements ===
const intersectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      scanText(entry.target);
    }
  });
});

document.querySelectorAll('*').forEach((el) => {
  intersectionObserver.observe(el);
});