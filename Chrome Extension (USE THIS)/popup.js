chrome.runtime.sendMessage({ type: "getDetoxLog" }, response => {
  const detoxLog = response.detoxLog || [];
  const tableBody = document.getElementById('detoxTableBody');
  tableBody.innerHTML = '';

  if (detoxLog.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="2" style="text-align:center">No detoxified messages yet.</td>`;
    tableBody.appendChild(row);
  } else {
    detoxLog.forEach(({ original, detoxified }) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${original}</td><td>${detoxified}</td>`;
      tableBody.appendChild(row);
    });
  }
});