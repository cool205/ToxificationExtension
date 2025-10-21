chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "logDetox") {
    // Relay to popup
    chrome.runtime.sendMessage(message);
  }
});