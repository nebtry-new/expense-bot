// ทริปที่ column is_billable ยังไม่มี (ยังไม่รัน migration_008) ถือว่าพร้อมเรียกเก็บ เหมือนพฤติกรรมเดิม
function isTripBillable(trip) {
  return trip?.is_billable !== false;
}

// เลือกรายการที่เข้ารอบเรียกเก็บ
// - ไม่ระบุ tripId: รายการทั่วไป + รายการของทริปที่ billable
// - ระบุ tripId: เฉพาะทริปนั้น (ไม่สนสถานะ)
function selectBillableExpenses(expenses = [], trips = [], { tripId = null } = {}) {
  if (tripId) {
    return expenses.filter((e) => e.tripId === tripId);
  }
  const billableTripIds = new Set(trips.filter(isTripBillable).map((t) => t.id));
  return expenses.filter((e) => !e.tripId || billableTripIds.has(e.tripId));
}

// ทริปที่ยังไม่พร้อมเรียกเก็บ + ยอดรวมรายการที่ยังไม่เคลียร์ (ไม่รวมทริปที่ไม่มีรายการค้าง)
function summarizePendingTrips(expenses = [], trips = []) {
  return trips
    .filter((t) => !isTripBillable(t))
    .map((t) => {
      const items = expenses.filter((e) => e.tripId === t.id && !e.isCleared && e.splitMode !== 'none');
      return { name: t.name, total: items.reduce((sum, e) => sum + Number(e.amount || 0), 0), count: items.length };
    })
    .filter((t) => t.count > 0);
}

module.exports = { isTripBillable, selectBillableExpenses, summarizePendingTrips };
