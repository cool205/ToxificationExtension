let detoxLog = [];

// Single listener handling multiple message types. For async responses, return true.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "logDetox") {
    detoxLog.push(msg.payload);
    console.log("Log updated:", detoxLog);
    // no response expected
    return;
  }

  if (msg.type === "getDetoxLog") {
    sendResponse({ detoxLog });
    return;
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