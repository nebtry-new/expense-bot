const settlementState = { pendingByUser: {} };
const paymentConfirmState = { pendingByUser: {} };
const deleteConfirmState = { pendingByUser: {} };
const slipConfirmState = { pendingByUser: {} };
const evRouteState = { pendingByUser: {} };

function clearAllState() {
  settlementState.pendingByUser = {};
  paymentConfirmState.pendingByUser = {};
  deleteConfirmState.pendingByUser = {};
  slipConfirmState.pendingByUser = {};
  evRouteState.pendingByUser = {};
}

module.exports = { settlementState, paymentConfirmState, deleteConfirmState, slipConfirmState, evRouteState, clearAllState };
