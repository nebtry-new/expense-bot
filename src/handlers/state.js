const settlementState = { pendingByUser: {} };
const deleteConfirmState = { pendingByUser: {} };
const slipConfirmState = { pendingByUser: {} };
const deleteListState = { pendingByUser: {} }; // { [userId]: [{ id, description, amount }] }
const nlCommandState = { pendingByUser: {} }; // { canonical, createdAt } คำสั่งที่ AI ตีความ รอผู้ใช้ยืนยัน
const notifListState = { pendingByUser: {} }; // { [userId]: [notificationId] } ลำดับที่แสดงให้ผู้ใช้ล่าสุด — ปุ่ม/เลขยกเลิกอ้างอิงลิสต์นี้
const eventListState = { pendingByUser: {} }; // { [userId]: [eventId] } ลำดับวันสำคัญที่แสดงล่าสุด — เลข/ปุ่มลบอ้างอิงลิสต์นี้
const todoListState = { pendingByUser: {} }; // { [userId]: [todoId] } ลำดับ To-Do ที่แสดงล่าสุด — เลข/ปุ่มเสร็จ/ลบอ้างอิงลิสต์นี้
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
  eventListState.pendingByUser = {};
  todoListState.pendingByUser = {};
  datetimePickerState.pendingByUser = {};
}

module.exports = { settlementState, deleteConfirmState, deleteListState, nlCommandState, notifListState, eventListState, todoListState, slipConfirmState, evRouteState, datetimePickerState, clearAllState };
