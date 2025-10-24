let detoxLog = [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "logDetox") {
    detoxLog.push(msg.payload);
    console.log("Log updated:", detoxLog);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "getDetoxLog") {
    sendResponse({ detoxLog });
  }
});