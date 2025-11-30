let detoxLog = [];
let detectedLog = [];
const connectedPorts = new Map();

const CONFIG = {
  API_BASE: "https://TechKid0109-Detox-Extension.hf.space",
  TOXIC_CONFIDENCE_THRESHOLD: 98,
  MAX_RETRIES: 4,
  LOG_CAP: 500,
  DETOX_CONCURRENCY: 4
};

// In-memory caches to reduce duplicate API calls for identical texts
const classificationCache = new Map(); // key -> { ts, result }
const detoxCache = new Map(); // key -> { ts, output }
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

// Delay helper
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// storage helpers
function storageGet(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    } catch (e) {
      resolve({});
    }
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(obj, () => resolve());
    } catch (e) {
      resolve();
    }
  });
}

// Warm up caches from storage at startup
(async function warmupCaches() {
  try {
    const stored = await storageGet(['classificationCache', 'detoxCache']);
    if (stored.classificationCache) {
      Object.entries(stored.classificationCache).forEach(([k, v]) => {
        try { classificationCache.set(k, v); } catch (e) {}
      });
    }
    if (stored.detoxCache) {
      Object.entries(stored.detoxCache).forEach(([k, v]) => {
        try { detoxCache.set(k, v); } catch (e) {}
      });
    }
  } catch (e) {
    /* ignore */
  }
})();

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
    const key = String(text).slice(0, 5000);
    const now = Date.now();
    const cached = classificationCache.get(key);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return Object.assign({}, cached.result, { cached: true });
    }

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

    const result = {
      success: true,
      classification: data.classification,
      isToxic,
      confidence: { label0: label0Confidence, label1: label1Confidence },
      attempts: res.attempts
    };

    try {
      classificationCache.set(key, { ts: Date.now(), result });
      // persist whole cache (simple approach)
      const serialized = {};
      classificationCache.forEach((v, k) => { serialized[k] = v; });
      storageSet({ classificationCache: serialized });
    } catch (e) {}

    return result;
  } catch (err) {
    console.error("Classification error:", err);
    return { success: false, error: String(err), attempts: 0 };
  }
}

async function detoxifyTextSingle(text) {
  const key = String(text).slice(0, 5000);
  const now = Date.now();
  const cached = detoxCache.get(key);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return { output: cached.output, attempts: 0, error: null, cached: true };
  }

  const classification = await classifyText(text);
  if (!(classification.success && classification.isToxic)) {
    // cache that detox is not needed
    try {
      detoxCache.set(key, { ts: Date.now(), output: text });
      const serialized = {};
      detoxCache.forEach((v, k) => { serialized[k] = v; });
      storageSet({ detoxCache: serialized });
    } catch (e) {}
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

  try { detoxCache.set(key, { ts: Date.now(), output });
    const serialized = {};
    detoxCache.forEach((v, k) => { serialized[k] = v; });
    storageSet({ detoxCache: serialized });
  } catch (e) {}
  return { output, attempts: r.attempts, error: null };
}

async function detoxifyTextBatch(texts) {
  // Run detox operations with limited concurrency to speed up throughput
  const tasks = texts.map((t) => {
    return async () => {
      const capped = typeof t === "string" && t.length > 5000 ? t.slice(0, 5000) : t;
      return detoxifyTextSingle(capped);
    };
  });

  const concurrency = CONFIG.DETOX_CONCURRENCY || 4;
  const results = new Array(tasks.length);
  let idx = 0;

  const workers = new Array(concurrency).fill(0).map(async () => {
    while (true) {
      const i = idx++;
      if (i >= tasks.length) break;
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        results[i] = { output: texts[i], attempts: 0, error: String(e) };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "logDetox":
      {
        const entry = Object.assign({}, msg.payload || {});
        if (sender && sender.tab) {
          entry.tabId = sender.tab.id;
          entry.pageUrl = sender.tab.url;
        }
        pushWithCap(detoxLog, entry);
      }
      break;

    case "logDetected":
      {
        const entry = Object.assign({}, msg.payload || {});
        if (sender && sender.tab) {
          entry.tabId = sender.tab.id;
          entry.pageUrl = sender.tab.url;
        }
        pushWithCap(detectedLog, entry);
      }
      break;

    case "getDetoxLog":
      sendResponse({
        pairs: detoxLog.map(e => ({
          id: e.id ?? null,
          original: e.original,
          detoxified: e.detoxified,
          attempts: e.attempts,
          error: e.error,
          tabId: e.tabId ?? null,
          pageUrl: e.pageUrl ?? null
        })),
        allScanned: detectedLog.map(e => ({
          id: e.id ?? null,
          text: e.text,
          isToxic: e.isToxic,
          timestamp: e.timestamp ?? null,
          tabId: e.tabId ?? null,
          pageUrl: e.pageUrl ?? null
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
            // classify in parallel; classifyText uses cache so repeated texts are fast
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