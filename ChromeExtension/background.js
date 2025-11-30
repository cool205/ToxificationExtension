let detoxLog = [];
let detectedLog = [];
const connectedPorts = new Map();

const CONFIG = {
  API_BASE: "https://TechKid0109-Detox-Extension.hf.space",
  TOXIC_CONFIDENCE_THRESHOLD: 98,
  MAX_RETRIES: 4,
  LOG_CAP: 500
};

// Delay helper
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Push with cap
function pushWithCap(log, entry, cap = CONFIG.LOG_CAP) {
  log.push(entry);
  if (log.length > cap) log.shift();
}

// Exponential retry
async function fetchWithRetry(url, options, maxAttempts = CONFIG.MAX_RETRIES) {
  const baseDelay = 1000;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        if (attempt < maxAttempts && (res.status === 429 || res.status >= 500)) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await wait(delay + Math.floor(Math.random() * 100));
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
        await wait(delay + Math.floor(Math.random() * 100));
        continue;
      }
      return { success: false, error: String(lastError), attempts: attempt };
    }
  }
  return { success: false, error: String(lastError), attempts: maxAttempts };
}

async function classifyText(text) {
  try {
    const res = await fetchWithRetry(`${CONFIG.API_BASE}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (!res.success) {
      return { success: false, error: res.error, attempts: res.attempts };
    }

    const data = res.json;
    const conf = data?.confidence || {};
    const label0Confidence = conf.LABEL_0 ?? 0;
    const label1Confidence = conf.LABEL_1 ?? 0;

    // Use classification string + threshold
    const isToxic =
      data.classification === "LABEL_1" &&
      label1Confidence * 100 >= CONFIG.TOXIC_CONFIDENCE_THRESHOLD;

    return {
      success: true,
      classification: data.classification,
      isToxic,
      confidence: { label0: label0Confidence, label1: label1Confidence },
      attempts: res.attempts
    };
  } catch (err) {
    console.error("Classification error:", err);
    return { success: false, error: String(err), attempts: 0 };
  }
}

async function detoxifyTextSingle(text) {
  const classification = await classifyText(text);
  if (!(classification.success && classification.isToxic)) {
    return {
      output: text,
      attempts: classification.attempts,
      error: classification.success ? null : classification.error
    };
  }

  const r = await fetchWithRetry(`${CONFIG.API_BASE}/detoxify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (!r.success) {
    return { output: text, attempts: r.attempts, error: r.error };
  }

  const json = r.json || {};
  const output =
    json.detoxified ||
    (Array.isArray(json.data) ? json.data[0] : Array.isArray(json.output) ? json.output[0] : text) ||
    text;

  return { output, attempts: r.attempts, error: null };
}

async function detoxifyTextBatch(texts) {
  const results = [];
  for (const t of texts) {
    const capped = typeof t === "string" && t.length > 5000 ? t.slice(0, 5000) : t;
    const res = await detoxifyTextSingle(capped);
    results.push(res);
    await wait(50 + Math.floor(Math.random() * 50));
  }
  return results;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "logDetox":
      pushWithCap(detoxLog, msg.payload);
      break;

    case "logDetected":
      pushWithCap(detectedLog, msg.payload);
      break;

    case "getDetoxLog":
      sendResponse({
        pairs: detoxLog.map(e => ({
          id: e.id ?? null,
          original: e.original,
          detoxified: e.detoxified,
          attempts: e.attempts,
          error: e.error
        })),
        allScanned: detectedLog.map(e => ({
          id: e.id ?? null,
          text: e.text,
          isToxic: e.isToxic,
          timestamp: e.timestamp ?? null
        }))
      });
      break;

    case "clearDetected":
      detectedLog.length = 0;
      sendResponse({ success: true });
      break;

    case "clearChanged":
      detoxLog.length = 0;
      sendResponse({ success: true });
      break;

    case "classifyText":
      (async () => {
        try {
          if (Array.isArray(msg.texts)) {
            const results = await Promise.all(msg.texts.map(classifyText));
            sendResponse({
              success: true,
              results: results.map(r => ({
                success: r.success,
                isToxic: r.success ? r.isToxic : null,
                error: r.success ? null : r.error
              }))
            });
          } else {
            const result = await classifyText(msg.text);
            sendResponse({
              success: result.success,
              isToxic: result.success ? result.isToxic : null,
              error: result.success ? null : result.error
            });
          }
        } catch (err) {
          console.error("Classification error:", err);
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;

    case "detoxifyText":
      (async () => {
        try {
          if (Array.isArray(msg.texts)) {
            const results = await detoxifyTextBatch(msg.texts);
            sendResponse({
              success: true,
              outputs: results.map(r => r.output),
              attempts: results.map(r => r.attempts),
              errors: results.map(r => r.error)
            });
          } else {
            const res = await detoxifyTextSingle(msg.text);
            sendResponse({
              success: true,
              outputs: [res.output],
              attempts: [res.attempts],
              errors: [res.error]
            });
          }
        } catch (err) {
          console.error("Detoxify error:", err);
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
  }
});