let detoxLog = [];
let detectedLog = [];

// Configuration
const CONFIG = {
  CLASSIFY_ENDPOINT: "https://your-classification-model.hf.space/run/predict",
  DETOX_ENDPOINT: "https://techkid0109-detoxificationai.hf.space/run/predict",
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  BACKOFF_FACTOR: 1.5
};

// Utility for delayed retry with exponential backoff
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, options, retries = CONFIG.MAX_RETRIES) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    if (retries <= 0) throw err;
    await wait(CONFIG.RETRY_DELAY * Math.pow(CONFIG.BACKOFF_FACTOR, CONFIG.MAX_RETRIES - retries));
    return fetchWithRetry(url, options, retries - 1);
  }
}

// Classify text as toxic or non-toxic with retry logic
async function classifyText(text) {
  try {
    // TODO: Replace mockup with actual API call
    // For now, use keyword detection but wrapped in retry logic
    const mockApiCall = async () => {
      const toxicWords = ["hate", "kill", "stupid", "idiot", "ugly", "trash"];
      const hasToxic = toxicWords.some(word => 
        typeof text === 'string' && text.toLowerCase().includes(word)
      );
      return { data: [{ toxic: hasToxic }] };
    };

    // Simulate network call with retry
    const json = await mockApiCall();
    return { 
      success: true, 
      isToxic: json?.data?.[0]?.toxic ?? false 
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
    sendResponse({ detoxLog, detectedLog });
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
        const endpoint = "https://techkid0109-detoxificationai.hf.space/run/predict";
        const maxLen = 5000;

        if (Array.isArray(msg.texts)) {
          // Batch mode: truncate each entry and send as data array
          const payloads = msg.texts.map(t => (typeof t === 'string' && t.length > maxLen) ? t.slice(0, maxLen) : t);
          const body = JSON.stringify({ data: payloads });

          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          const json = await res.json();

          // Expect json.data to be an array of outputs for batch calls
          let outputs = [];
          if (json && Array.isArray(json.data)) {
            outputs = json.data.map(item => {
              if (typeof item === 'string') return item;
              if (Array.isArray(item)) return item.join('');
              return String(item);
            });
          } else if (json && Array.isArray(json.output)) {
            outputs = json.output.map(x => (typeof x === 'string' ? x : String(x)));
          } else {
            // Fallback: wrap any parseable top-level into an array of same length
            outputs = payloads.map(() => '');
          }

          sendResponse({ success: true, outputs });
          return;
        }

        // Single-text mode (backwards compatible)
        const text = msg.text || "";
        const payloadText = (typeof text === 'string' && text.length > maxLen) ? text.slice(0, maxLen) : text;
        const body = JSON.stringify({ data: [payloadText] });

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        const json = await res.json();

        let output = "";
        if (json && Array.isArray(json.data) && typeof json.data[0] === 'string') {
          output = json.data[0];
        } else if (json && typeof json.data === 'string') {
          output = json.data;
        } else if (json && json.output) {
          if (Array.isArray(json.output)) output = json.output.join('');
          else if (typeof json.output === 'string') output = json.output;
        } else if (typeof json === 'string') {
          output = json;
        }

        sendResponse({ success: true, output });
      } catch (err) {
        console.error("detoxifyText error", err);
        sendResponse({ success: false, error: String(err) });
      }
    })();

    // Keep the channel open for the async response
    return true;
  }
});