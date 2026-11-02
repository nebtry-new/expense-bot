const settlementState = { pendingByUser: {} };
const deleteConfirmState = { pendingByUser: {} };
const slipConfirmState = { pendingByUser: {} };
const deleteListState = { pendingByUser: {} }; // { [userId]: [{ id, description, amount }] }
const nlCommandState = { pendingByUser: {} }; // { canonical, createdAt } คำสั่งที่ AI ตีความ รอผู้ใช้ยืนยัน
const notifListState = { pendingByUser: {} }; // { [userId]: [notificationId] } ลำดับที่แสดงให้ผู้ใช้ล่าสุด — ปุ่ม/เลขยกเลิกอ้างอิงลิสต์นี้
const evRouteState = { pendingByUser: {} };
const datetimePickerState = { pendingByUser: {} }; // { scheduledAt: Date }

function clearAllState() {
  settlementState.pendingByUser = {};
  deleteConfirmState.pendingByUser = {};
  slipConfirmState.pendingByUser = {};
  deleteListState.pendingByUser = {};
  nlCommandState.pendingByUser = {};
  evRouteState.pendingByUser = {};
  notifListState.pendingByUser = {};
  datetimePickerState.pendingByUser = {};
}

module.exports = { settlementState, deleteConfirmState, deleteListState, nlCommandState, notifListState, slipConfirmState, evRouteState, datetimePickerState, clearAllState };
