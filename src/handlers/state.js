const settlementState = { pendingByUser: {} };
const paymentConfirmState = { pendingByUser: {} };
const deleteConfirmState = { pendingByUser: {} };
const slipConfirmState = { pendingByUser: {} };
const evRouteState = { pendingByUser: {} };
const datetimePickerState = { pendingByUser: {} }; // { scheduledAt: Date }

function clearAllState() {
  settlementState.pendingByUser = {};
  paymentConfirmState.pendingByUser = {};
  deleteConfirmState.pendingByUser = {};
  slipConfirmState.pendingByUser = {};
  evRouteState.pendingByUser = {};
  datetimePickerState.pendingByUser = {};
}

module.exports = { settlementState, paymentConfirmState, deleteConfirmState, slipConfirmState, evRouteState, datetimePickerState, clearAllState };
