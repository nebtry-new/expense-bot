const settlementState = { pendingByUser: {} };
const paymentConfirmState = { pendingByUser: {} };
const deleteConfirmState = { pendingByUser: {} };
const slipConfirmState = { pendingByUser: {} };
const deleteListState = { pendingByUser: {} }; // { [userId]: [{ id, description, amount }] }
const evRouteState = { pendingByUser: {} };
const datetimePickerState = { pendingByUser: {} }; // { scheduledAt: Date }

function clearAllState() {
  settlementState.pendingByUser = {};
  paymentConfirmState.pendingByUser = {};
  deleteConfirmState.pendingByUser = {};
  slipConfirmState.pendingByUser = {};
  deleteListState.pendingByUser = {};
  evRouteState.pendingByUser = {};
  datetimePickerState.pendingByUser = {};
}

module.exports = { settlementState, paymentConfirmState, deleteConfirmState, deleteListState, slipConfirmState, evRouteState, datetimePickerState, clearAllState };
