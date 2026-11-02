const settlementState = { pendingByUser: {} };
const paymentConfirmState = { pendingByUser: {} };
const deleteConfirmState = { pendingByUser: {} };
const slipConfirmState = { pendingByUser: {} };
const deleteListState = { pendingByUser: {} }; // { [userId]: [{ id, description, amount }] }
const nlCommandState = { pendingByUser: {} }; // { canonical, createdAt } คำสั่งที่ AI ตีความ รอผู้ใช้ยืนยัน
const evRouteState = { pendingByUser: {} };
const datetimePickerState = { pendingByUser: {} }; // { scheduledAt: Date }

function clearAllState() {
  settlementState.pendingByUser = {};
  paymentConfirmState.pendingByUser = {};
  deleteConfirmState.pendingByUser = {};
  slipConfirmState.pendingByUser = {};
  deleteListState.pendingByUser = {};
  nlCommandState.pendingByUser = {};
  evRouteState.pendingByUser = {};
  datetimePickerState.pendingByUser = {};
}

module.exports = { settlementState, paymentConfirmState, deleteConfirmState, deleteListState, nlCommandState, slipConfirmState, evRouteState, datetimePickerState, clearAllState };
