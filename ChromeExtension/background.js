let detoxLog = [];
let detectedLog = [];

// Keep track of connected ports to keep the service worker alive while content scripts are open
const connectedPorts = new Map();

// Configuration
const CONFIG = {
  API_BASE: "https://TechKid0109-Detox-Extension.hf.space",
  TOXIC_CONFIDENCE_THRESHOLD: 0.95,
  MAX_RETRIES: 4
};

// Utility for delayed retry with exponential backoff
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Exponential retry that reports attempt counts and doesn't throw immediately
// Returns { success: true, json, attempts } or { success: false, error, attempts }
async function fetchWithRetry(url, options, maxAttempts = 4) {
  const baseDelay = 1000; // 1s, then 2s, 4s, 8s
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        // If rate limited (429) or server error (5xx) allow retry
        if (attempt < maxAttempts) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await wait(delay);
          continue;
        }
        return { success: false, error: String(lastError), attempts: attempt };
      }
      const json = await res.json();
      return { success: true, json, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await wait(delay);
        continue;
      }
      return { success: false, error: String(lastError), attempts: attempt };
    }
  }
  return { success: false, error: String(lastError), attempts: maxAttempts };
}

// Classify text as toxic or non-toxic with retry logic and confidence threshold
async function classifyText(text) {
  try {
    const res = await fetchWithRetry(`${CONFIG.API_BASE}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, threshold: CONFIG.TOXIC_CONFIDENCE_THRESHOLD })
    }, CONFIG.MAX_RETRIES || 4);

    if (!res.success) return { success: false, error: res.error, attempts: res.attempts };

    const response = res.json;
    // Check toxic confidence threshold from response confidence object
    const toxicConfidence = response?.confidence?.toxic || 0;
    return {
      success: true,
      isToxic: toxicConfidence >= CONFIG.TOXIC_CONFIDENCE_THRESHOLD,
      confidence: toxicConfidence,
      attempts: res.attempts
    };
  } catch (err) {
    console.error("Classification error:", err);
    return { success: false, error: String(err) };
  }
}

// Single listener handling multiple message types. For async responses, return true.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "logDetox") {
    detoxLog.push(msg.payload);
    console.log("Log updated:", detoxLog);
    // no response expected
    return;
  }

  if (msg.type === "logDetected") {
    detectedLog.push(msg.payload);
    console.log("Detected log updated:", detectedLog);
    return;
  }

  if (msg.type === "getDetoxLog") {
    // toxic/detox pairs for table
    const pairs = (detoxLog || []).map(e => ({
      original: e.original,
      detoxified: e.detoxified,
      attempts: e.attempts,
      error: e.error
    }));
    // all scanned text for dropdown, with toxicity
    const allScanned = (detectedLog || []).map(e => ({
      text: e.text,
      isToxic: e.isToxic
    }));
    sendResponse({ pairs, allScanned });
    return;
  }

  if (msg.type === "clearDetected") {
    detectedLog.length = 0;
    sendResponse({ success: true });
    return;
  }

  if (msg.type === "clearChanged") {
    detoxLog.length = 0;
    sendResponse({ success: true });
    return;
  }

  if (msg.type === "classifyText") {
    (async () => {
      try {
        if (Array.isArray(msg.texts)) {
          // Batch classification
          const results = await Promise.all(msg.texts.map(classifyText));
          sendResponse({
            success: true,
            results: results.map(r => r.success ? r.isToxic : false)
          });
        } else {
          // Single text classification
          const result = await classifyText(msg.text);
          sendResponse({
            success: true,
            isToxic: result.success ? result.isToxic : false
          });
        }
      } catch (err) {
        console.error("Classification error:", err);
        sendResponse({ success: false, error: String(err) });
      }
    })();
    return true;
  }

  if (msg.type === "detoxifyText") {
    // Support both single-string (`text`) and batched (`texts`) requests.
    (async () => {
      try {
        const maxLen = 5000;

        if (Array.isArray(msg.texts)) {
          // Batch mode
          const texts = msg.texts.map(t => (typeof t === 'string' && t.length > maxLen) ? t.slice(0, maxLen) : t);

          // Classify all texts first (in parallel, each classify has its own retry attempts)
          const classifications = await Promise.all(texts.map(t => classifyText(t)));

          // For toxic items, call detoxify with retry; do these sequentially with a small delay to reduce burst rate
          const outputs = [];
          const attempts = [];
          const errors = [];

          for (let i = 0; i < texts.length; i++) {
            const original = texts[i];
            const cls = classifications[i];

            if (cls && cls.success && cls.isToxic) {
              // Detoxify with retry
              const r = await fetchWithRetry(`${CONFIG.API_BASE}/detoxify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: original })
              }, CONFIG.MAX_RETRIES || 4);

              if (r.success) {
                // Try multiple common fields to extract detoxified text
                const json = r.json || {};
                const out = json.detoxified || (Array.isArray(json.data) ? json.data[0] : (Array.isArray(json.output) ? json.output[0] : '')) || original;
                outputs.push(out);
                attempts.push(r.attempts || 1);
                errors.push(null);
              } else {
                outputs.push(original);
                attempts.push(r.attempts || 0);
                errors.push(r.error || 'detox error');
              }

              // Small delay between detox calls to reduce rate-limits (200ms)
              await wait(200);
            } else {
              // Not toxic or classification failed -> return original text
              outputs.push(original);
              attempts.push(cls && cls.attempts ? cls.attempts : 0);
              errors.push(cls && !cls.success ? cls.error : null);
            }
          }

          sendResponse({ success: true, outputs, attempts, errors });
          return;
        }

        // Single-text mode
        const text = msg.text || "";
        const payloadText = (typeof text === 'string' && text.length > maxLen) ? text.slice(0, maxLen) : text;

        const classification = await classifyText(payloadText);
        if (!(classification && classification.success && classification.isToxic)) {
          // Not toxic (or classification failed) -> return original
          sendResponse({ success: true, output: payloadText, attempts: classification && classification.attempts ? classification.attempts : 0, error: classification && !classification.success ? classification.error : null });
          return;
        }

        const r = await fetchWithRetry(`${CONFIG.API_BASE}/detoxify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: payloadText })
        }, CONFIG.MAX_RETRIES || 4);

        if (!r.success) {
          sendResponse({ success: false, error: r.error, attempts: r.attempts });
          return;
        }

        const json = r.json || {};
        const output = json.detoxified || (Array.isArray(json.data) ? json.data[0] : (Array.isArray(json.output) ? json.output[0] : payloadText)) || payloadText;
        sendResponse({ success: true, output, attempts: r.attempts });
      } catch (err) {
        console.error("detoxifyText error", err);
        sendResponse({ success: false, error: String(err) });
      }
    })();

    // Keep the channel open for the async response
    return true;
  }
});

// Accept persistent connections from content scripts to keep service worker alive
chrome.runtime.onConnect.addListener((port) => {
  try {
    const name = port.name || Math.random().toString(36).slice(2);
    connectedPorts.set(name, port);
    console.log('Port connected:', name);

    port.onMessage.addListener((m) => {
      // simple ping handler
      if (m && m.type === 'keepAlivePing') {
        port.postMessage({ type: 'keepAlivePong' });
      }
    });

    port.onDisconnect.addListener(() => {
      connectedPorts.delete(name);
      console.log('Port disconnected:', name);
    });
  } catch (err) {
    console.warn('onConnect handler error', err);
  }
});