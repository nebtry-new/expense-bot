// tripsMap: { [tripId]: tripName } — ถ้าส่งมาจะแสดงชื่อทริปกำกับ
function formatExpenseLines(expenses, { filterActive = false, tripsMap = null } = {}) {
  const list = filterActive
    ? expenses.filter((e) => !e.isCleared && e.splitMode !== 'none')
    : expenses;

  return list.map((e) => {
    let tag = '';
    if (tripsMap && e.tripId) {
      const name = tripsMap[e.tripId];
      tag = name ? ` [${name}]` : ' 🗺';
    }
    return `• ${e.description}${tag} ${Number(e.amount).toLocaleString()} บาท`;
  });
}

module.exports = { formatExpenseLines };
