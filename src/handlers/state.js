const settlementState = { pendingByUser: {} };
const paymentConfirmState = { pendingByUser: {} };
const deleteConfirmState = { pendingByUser: {} };

function clearAllState() {
  settlementState.pendingByUser = {};
  paymentConfirmState.pendingByUser = {};
  deleteConfirmState.pendingByUser = {};
}

module.exports = { settlementState, paymentConfirmState, deleteConfirmState, clearAllState };
