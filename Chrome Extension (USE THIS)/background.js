let detoxLog = [];
let detectedLog = [];

// Configuration
const CONFIG = {
  API_BASE: "https://TechKid0109-DetoxificationAI.hf.space",
  TOXIC_CONFIDENCE_THRESHOLD: 0.7,
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

// Classify text as toxic or non-toxic with retry logic and confidence threshold
async function classifyText(text) {
  try {
    const response = await fetchWithRetry(`${CONFIG.API_BASE}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text,
        threshold: CONFIG.TOXIC_CONFIDENCE_THRESHOLD
      })
    });

    return {
      success: true,
      isToxic: response.toxic === true,
      confidence: response.confidence || {}
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
        const maxLen = 5000;

        if (Array.isArray(msg.texts)) {
          // Batch mode: truncate each entry and process individually
          // First classify all texts
          const classifications = await Promise.all(msg.texts.map(text => classifyText(text)));
          
          // Only detoxify texts that are classified as toxic with high confidence
          const results = await Promise.all(msg.texts.map(async (text, index) => {
            const classification = classifications[index];
            
            if (classification.success && classification.isToxic) {
              const truncated = typeof text === 'string' && text.length > maxLen ? text.slice(0, maxLen) : text;
              const response = await fetchWithRetry(`${CONFIG.API_BASE}/detoxify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: truncated })
              });
              return response.detoxified || text;
            }
            return text; // Return original if not toxic or classification failed
          }));

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
        
        // First classify the text
        const classification = await classifyText(payloadText);
        
        // Only detoxify if classified as toxic with high confidence
        const response = classification.success && classification.isToxic ?
          await fetchWithRetry(`${CONFIG.API_BASE}/detoxify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: payloadText })
          }) : { detoxified: payloadText };

        const output = response.detoxified || payloadText;
        if (!output) {
          throw new Error('No detoxified output received');
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