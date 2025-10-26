// Keep track of highlighted elements on the page
let currentHighlight = null;

// Create highlighted text display
const highlightDisplay = document.createElement('div');
highlightDisplay.id = 'highlightDisplay';
highlightDisplay.style.padding = '8px';
highlightDisplay.style.marginBottom = '10px';
highlightDisplay.style.borderRadius = '4px';
highlightDisplay.style.backgroundColor = '#f8f9fa';
highlightDisplay.style.display = 'none';
document.body.insertBefore(highlightDisplay, document.body.firstChild);

// Function to update the tables
function updateTables(detoxLog = [], detectedLog = []) {
  // Update counters
  document.getElementById('detectedCount').textContent = detectedLog.length;
  document.getElementById('changedCount').textContent = detoxLog.length;
  
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
      row.addEventListener('mouseenter', () => {
        highlightText(id);
        highlightDisplay.textContent = text;
        highlightDisplay.style.display = 'block';
      });
      row.addEventListener('mouseleave', () => {
        removeHighlight();
        highlightDisplay.style.display = 'none';
      });
      row.addEventListener('click', () => {
        removeHighlight();
        highlightDisplay.style.display = 'none';
      });
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
      row.addEventListener('mouseenter', () => {
        highlightText(id);
        highlightDisplay.textContent = original;
        highlightDisplay.style.display = 'block';
      });
      row.addEventListener('mouseleave', () => {
        removeHighlight();
        highlightDisplay.style.display = 'none';
      });
      row.addEventListener('click', () => {
        removeHighlight();
        highlightDisplay.style.display = 'none';
      });
      detoxBody.appendChild(row);
    });
  }
}

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Function to highlight text on the page
const highlightText = debounce((id) => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { 
      type: 'highlightText', 
      id 
    });
  });
}, 100);

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
  // First remove any active highlights
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'removeHighlight' });
  });

  // Then clear the entries
  chrome.runtime.sendMessage({ type: 'clearDetected' }, () => {
    chrome.runtime.sendMessage({ type: "getDetoxLog" }, response => {
      updateTables(response.detoxLog, []);
    });
  });
});

document.getElementById('clearChanged').addEventListener('click', () => {
  // First remove any active highlights
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'removeHighlight' });
  });

  // Then clear the entries
  chrome.runtime.sendMessage({ type: 'clearChanged' }, () => {
    chrome.runtime.sendMessage({ type: "getDetoxLog" }, response => {
      updateTables([], response.detectedLog);
    });
  });
});

// Update tables when URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    chrome.runtime.sendMessage({ type: "getDetoxLog" }, response => {
      updateTables(response.detoxLog || [], response.detectedLog || []);
    });
  }
});

// Initial load
chrome.runtime.sendMessage({ type: "getDetoxLog" }, response => {
  updateTables(response.detoxLog || [], response.detectedLog || []);
});