const settlementState = { pendingByUser: {} };
const deleteConfirmState = { pendingByUser: {} };
const slipConfirmState = { pendingByUser: {} };
const deleteListState = { pendingByUser: {} }; // { [userId]: [{ id, description, amount }] }
const nlCommandState = { pendingByUser: {} }; // { canonical, createdAt } คำสั่งที่ AI ตีความ รอผู้ใช้ยืนยัน
const notifListState = { pendingByUser: {} }; // { [userId]: [notificationId] } ลำดับที่แสดงให้ผู้ใช้ล่าสุด — ปุ่ม/เลขยกเลิกอ้างอิงลิสต์นี้
const eventListState = { pendingByUser: {} }; // { [userId]: [eventId] } ลำดับวันสำคัญที่แสดงล่าสุด — เลข/ปุ่มลบอ้างอิงลิสต์นี้
const todoListState = { pendingByUser: {} }; // { [userId]: [todoId] } ลำดับ To-Do ที่แสดงล่าสุด — เลข/ปุ่มเสร็จ/ลบอ้างอิงลิสต์นี้
const restaurantListState = { pendingByUser: {} }; // { [userId]: [restaurantId] } ลิสต์ร้านที่แสดงล่าสุด — เลข/ปุ่มอ้างอิงลิสต์นี้
const restaurantPickState = { pendingByUser: {} }; // { [userId]: restaurantId } ร้านที่สุ่มได้ล่าสุด (ปุ่ม ไปกินแล้ว)
const wishListState = { pendingByUser: {} }; // { [userId]: [wishId] } wishlist ของตัวเองที่แสดงล่าสุด
const partnerWishState = { pendingByUser: {} }; // { [userId]: [wishId] } wishlist ของแฟนที่แสดงล่าสุด (ให้ของขวัญแฟน [เลข])
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
  restaurantListState.pendingByUser = {};
  restaurantPickState.pendingByUser = {};
  wishListState.pendingByUser = {};
  partnerWishState.pendingByUser = {};
  datetimePickerState.pendingByUser = {};
}

module.exports = { settlementState, deleteConfirmState, deleteListState, nlCommandState, notifListState, eventListState, todoListState, restaurantListState, restaurantPickState, wishListState, partnerWishState, slipConfirmState, evRouteState, datetimePickerState, clearAllState };
