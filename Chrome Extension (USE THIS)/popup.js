// Keep track of highlighted elements on the page
let currentHighlight = null;

// Function to update the tables
function updateTables(detoxLog = [], detectedLog = []) {
  // Update detected (non-toxic) text table
  const detectedBody = document.getElementById('detectedTableBody');
  detectedBody.innerHTML = '';

  if (detectedLog.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `<td style="text-align:center">No non-toxic text detected yet.</td>`;
    detectedBody.appendChild(row);
  } else {
    detectedLog.forEach(({ text, timestamp, id }) => {
      const row = document.createElement('tr');
      row.dataset.textId = id;
      row.innerHTML = `<td style="background-color: #e6ffed">${text}</td>`;
      row.addEventListener('mouseenter', () => highlightText(id));
      row.addEventListener('mouseleave', () => removeHighlight());
      detectedBody.appendChild(row);
    });
  }

  // Update changed (toxic → detoxified) table
  const detoxBody = document.getElementById('detoxTableBody');
  detoxBody.innerHTML = '';

  if (detoxLog.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="2" style="text-align:center">No detoxified messages yet.</td>`;
    detoxBody.appendChild(row);
  } else {
    detoxLog.forEach(({ original, detoxified, id }) => {
      const row = document.createElement('tr');
      row.dataset.textId = id;
      row.innerHTML = `
        <td style="background-color: #ffecec">${original}</td>
        <td style="background-color: #e6ffed">${detoxified}</td>
      `;
      row.addEventListener('mouseenter', () => highlightText(id));
      row.addEventListener('mouseleave', () => removeHighlight());
      detoxBody.appendChild(row);
    });
  }
}

// Function to highlight text on the page
function highlightText(id) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { 
      type: 'highlightText', 
      id 
    });
  });
}

// Function to remove highlight
function removeHighlight() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { 
      type: 'removeHighlight' 
    });
  });
}

// Clear buttons event handlers
document.getElementById('clearDetected').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clearDetected' }, () => {
    chrome.runtime.sendMessage({ type: "getDetoxLog" }, response => {
      updateTables(response.detoxLog, []);
    });
  });
});

document.getElementById('clearChanged').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clearChanged' }, () => {
    chrome.runtime.sendMessage({ type: "getDetoxLog" }, response => {
      updateTables([], response.detectedLog);
    });
  });
});

// Initial load
chrome.runtime.sendMessage({ type: "getDetoxLog" }, response => {
  updateTables(response.detoxLog || [], response.detectedLog || []);
});