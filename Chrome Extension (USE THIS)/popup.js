const tableBody = document.getElementById('detoxTableBody');

function addDetoxRow(original, detoxified) {
  const row = document.createElement('tr');

  const originalCell = document.createElement('td');
  originalCell.textContent = original;

  const detoxCell = document.createElement('td');
  detoxCell.textContent = detoxified;

  row.appendChild(originalCell);
  row.appendChild(detoxCell);
  tableBody.appendChild(row);
}

chrome.storage.local.get({ detoxLog: [] }, (data) => {
  const log = data.detoxLog;
  if (log.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.textContent = "No detoxified messages yet.";
    cell.style.textAlign = "center";
    row.appendChild(cell);
    tableBody.appendChild(row);
  } else {
    log.forEach(entry => {
      addDetoxRow(entry.original, entry.detoxified);
    });
  }
});