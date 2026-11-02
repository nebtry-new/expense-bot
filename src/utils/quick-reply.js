// แปลง { reply, quickReplies: [{ label, text }] } จาก handler เป็นข้อความ LINE ที่มีปุ่ม quick reply
// ปุ่มแต่ละอันส่ง "ข้อความคำสั่งเดิม" กลับมา จึงผ่าน flow/ขั้นตอนยืนยันเดิมทั้งหมด
const MAX_QUICK_REPLIES = 13; // ขีดจำกัดของ LINE
const MAX_LABEL = 20;

const truncate = (s, n = MAX_LABEL) => {
  const chars = [...String(s)];
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : chars.join('');
};

function buildQuickReplyMessage(text, quickReplies = []) {
  const items = quickReplies.slice(0, MAX_QUICK_REPLIES).map((q) => ({
    type: 'action',
    action: { type: 'message', label: truncate(q.label), text: q.text ?? q.label },
  }));
  return items.length ? { type: 'text', text, quickReply: { items } } : { type: 'text', text };
}

module.exports = { buildQuickReplyMessage, truncate, MAX_QUICK_REPLIES, MAX_LABEL };
