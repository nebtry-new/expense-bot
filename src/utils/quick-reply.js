// แปลง { reply, quickReplies: [{ label, text }] } จาก handler เป็นข้อความ LINE ที่มีปุ่ม quick reply
// ปุ่มแต่ละอันส่ง "ข้อความคำสั่งเดิม" กลับมา จึงผ่าน flow/ขั้นตอนยืนยันเดิมทั้งหมด
const MAX_QUICK_REPLIES = 13; // ขีดจำกัดของ LINE
const MAX_LABEL = 20;

const truncate = (s, n = MAX_LABEL) => {
  const chars = [...String(s)];
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : chars.join('');
};

// ปุ่ม ✖ ยกเลิก (postback → handleMenuPostback ล้างลิสต์/คำขอยืนยันที่ค้าง แล้วตอบว่าไม่ทำอะไรต่อ)
const CANCEL_DATA = 'action=menu_cancel';
const cancelItem = () => ({ type: 'action', action: { type: 'postback', label: '✖ ยกเลิก', data: CANCEL_DATA, displayText: 'ยกเลิก' } });

// ปุ่มที่ "ปฏิเสธ/ถอย" อยู่แล้ว (ยกเลิก / ไม่เอา / ยังก่อน / ไม่ลบ) — ไม่ต้องเติมปุ่มยกเลิกซ้ำ
const DISMISS_RE = /^(?:[^\p{L}\p{N}]*)(ยกเลิก|cancel|ไม่เอา|ยังก่อน|ไม่ลบ|ไม่บันทึก)$/iu;
const isDismiss = (q) => DISMISS_RE.test(String(q.text ?? '').trim()) || DISMISS_RE.test(String(q.label ?? '').trim());

// options.cancel = true → ผลลัพธ์ของคำสั่งที่มีปุ่มเลือก (เมนูชั้นลึกๆ) จะมีปุ่ม ✖ ยกเลิก เป็นปุ่มสุดท้าย
// เว้นแต่มีปุ่มปฏิเสธอยู่แล้ว; กันที่ไว้ 1 ช่องจากขีดจำกัด 13
function buildQuickReplyMessage(text, quickReplies = [], { cancel = false } = {}) {
  const addCancel = cancel && quickReplies.length > 0 && !quickReplies.some(isDismiss);
  const items = quickReplies.slice(0, addCancel ? MAX_QUICK_REPLIES - 1 : MAX_QUICK_REPLIES).map((q) => ({
    type: 'action',
    action: { type: 'message', label: truncate(q.label), text: q.text ?? q.label },
  }));
  if (addCancel) items.push(cancelItem());
  return items.length ? { type: 'text', text, quickReply: { items } } : { type: 'text', text };
}

// ผลลัพธ์ของ handleTextMessage → ข้อความที่ส่งกลับ LINE: template (replyMessage) > ข้อความ + ปุ่ม (มี ✖ ยกเลิก) > ข้อความล้วน
const toReplyPayload = (result) => result.replyMessage
  || (result.quickReplies?.length ? buildQuickReplyMessage(result.reply, result.quickReplies, { cancel: true }) : result.reply);

module.exports = { toReplyPayload, buildQuickReplyMessage, cancelItem, CANCEL_DATA, truncate, MAX_QUICK_REPLIES, MAX_LABEL };
