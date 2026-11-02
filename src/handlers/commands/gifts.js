// ของขวัญ: wishlist ของแต่ละคน + ประวัติของขวัญ (กันซื้อซ้ำ) — บอตจะ hint อีกฝ่ายก่อนวันสำคัญ (planner-reminders.js)
// ไม่แตะเรื่องเงิน: การให้ของขวัญไม่สร้างรายการค่าใช้จ่ายเอง (พิมพ์ ค่าของขวัญ 1200 ส่วนตัว ถ้าต้องการบันทึก)
const { getUsers, addWishItem, listWishItems, deleteWishItem, markWishGiven, addGift, listGifts } = require('../../services/db');
const { wishListState, partnerWishState } = require('../state');
const { localToday } = require('../../utils/planner-dates');
const { MONTH_LABELS } = require('../../utils/parse-date');

const MAX_BUTTONS = 12;
const MIGRATION_HINT = 'ยังใช้ฟีเจอร์นี้ไม่ได้ — ต้องรัน supabase/migration_013_restaurants_gifts.sql ใน Supabase ก่อน';

async function guarded(fn) {
  try {
    return await fn();
  } catch (error) {
    console.error('GIFT_COMMAND_FAILED', error?.message || error);
    return { type: 'error', reply: MIGRATION_HINT };
  }
}

async function couple(lineUserId) {
  const users = (await getUsers()).filter((u) => u.lineUserId);
  const me = users.find((u) => u.lineUserId === lineUserId);
  const partner = users.find((u) => u.lineUserId !== lineUserId);
  return { me, partner };
}
const NEED_BOTH = { type: 'error', reply: 'ต้องมีผู้ใช้ครบ 2 คนก่อน (ทั้งคู่พิมพ์ ลงทะเบียน ชื่อ)' };

const fmtPrice = (p) => (p == null ? '' : ` (฿${Number(p).toLocaleString('th-TH')})`);
const thaiDay = (iso) => { const t = localToday(new Date(iso)); return `${t.d} ${MONTH_LABELS[t.m]}`; };

// "รองเท้าผ้าใบ 1,200 บาท" → { title, price }
// ตัวเลขท้ายข้อความนับเป็นราคาเมื่อมีหน่วย บาท/฿ หรือมีค่า ≥ 100 ("iPhone 15" ไม่ใช่ราคา)
function parseTitlePrice(input) {
  const text = String(input).trim();
  const m = text.match(/^(.*?)\s*(\d[\d,]*(?:\.\d+)?)\s*(บาท|฿)?$/);
  if (m && m[1].trim()) {
    const price = Number(m[2].replace(/,/g, ''));
    if (m[3] || price >= 100) return { title: m[1].trim(), price };
  }
  return { title: text, price: null };
}

const normTitle = (s) => String(s).toLowerCase().replace(/\s+/g, '');
// ซ้ำ = เหมือนกัน หรือฝั่งหนึ่งอยู่ในอีกฝั่ง (ยาว ≥ 3 ตัว)
function similar(a, b) {
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)));
}

// ---------------------------------------------------------------- wishlist ของตัวเอง

function handleAddWish(input, lineUserId) {
  return guarded(async () => {
    const { me, partner } = await couple(lineUserId);
    if (!me) return { type: 'error', reply: 'ไม่พบผู้ใช้ในระบบ กรุณาลงทะเบียนก่อน' };
    const { title, price } = parseTitlePrice(input);
    if (!title) return { type: 'error', reply: 'ระบุของที่อยากได้ด้วย เช่น อยากได้ หูฟังไร้สาย 3500' };

    const mine = await listWishItems({ ownerLineUserId: lineUserId });
    const dup = mine.find((w) => similar(w.title, title));
    if (dup) return { type: 'noop', reply: `มีใน wishlist แล้ว: ${dup.title}${fmtPrice(dup.price)}`, quickReplies: [{ label: '✨ ดู wishlist', text: 'ของที่อยากได้' }] };

    await addWishItem({ ownerLineUserId: lineUserId, title, price });
    const lines = [`✨ จดไว้แล้ว: ${title}${fmtPrice(price)}`];
    if (partner) {
      lines.push(`${partner.displayName} ดูได้ด้วย ของขวัญแฟน และบอตจะแอบบอกก่อนวันสำคัญของคุณ`);
      const received = (await listGifts({ recipientLineUserId: lineUserId })).find((g) => similar(g.title, title));
      if (received) lines.push(`⚠️ เคยได้รับ "${received.title}" ไปแล้วเมื่อ ${thaiDay(received.createdAt)}`);
    }
    return { type: 'wish_added', reply: lines.join('\n'), quickReplies: [{ label: '✨ ดู wishlist', text: 'ของที่อยากได้' }] };
  });
}

function handleMyWishlist(lineUserId) {
  return guarded(async () => {
    const items = await listWishItems({ ownerLineUserId: lineUserId });
    if (!items.length) {
      delete wishListState.pendingByUser[lineUserId];
      return { type: 'wishlist', reply: 'ยังไม่มีของที่อยากได้\nเพิ่มได้ด้วย: อยากได้ หูฟังไร้สาย 3500' };
    }
    wishListState.pendingByUser[lineUserId] = items.map((w) => w.id);
    return {
      type: 'wishlist',
      reply: ['✨ ของที่คุณอยากได้', ...items.map((w, i) => `${i + 1}. ${w.title}${fmtPrice(w.price)}`), '', 'ลบ: แตะปุ่ม ❌ หรือพิมพ์ ลบของที่อยากได้ [เลข]'].join('\n'),
      quickReplies: items.slice(0, MAX_BUTTONS).map((w, i) => ({ label: `❌ ${i + 1}. ${w.title}`, text: `ลบของที่อยากได้ ${i + 1}` })),
    };
  });
}

function handleDeleteWish(input, lineUserId) {
  return guarded(async () => {
    const num = Number.parseInt(input, 10);
    const snapshot = wishListState.pendingByUser[lineUserId];
    if (!(num >= 1)) return { type: 'error', reply: 'ระบุเลข เช่น ลบของที่อยากได้ 1 (ดูเลขจาก ของที่อยากได้)' };
    if (!snapshot) return { type: 'noop', reply: 'ยังไม่มีลิสต์ พิมพ์ ของที่อยากได้ เพื่อดูรายการก่อน' };
    const id = snapshot[num - 1];
    if (!id) return { type: 'error', reply: `ไม่พบรายการเลข ${num} (เลือกเลข 1-${snapshot.length})` };

    const item = (await listWishItems({ ownerLineUserId: lineUserId })).find((w) => w.id === id);
    if (!item || !(await deleteWishItem(id))) return { type: 'error', reply: 'รายการนี้ถูกลบหรือถูกให้ไปแล้ว' };
    const rest = await handleMyWishlist(lineUserId);
    return { type: 'wish_deleted', reply: `ลบ "${item.title}" แล้ว\n\n${rest.reply}`, quickReplies: rest.quickReplies };
  });
}

// ---------------------------------------------------------------- ของขวัญให้แฟน

function handlePartnerGifts(lineUserId) {
  return guarded(async () => {
    const { me, partner } = await couple(lineUserId);
    if (!me || !partner) return NEED_BOTH;
    const [wishes, given] = await Promise.all([
      listWishItems({ ownerLineUserId: partner.lineUserId }),
      listGifts({ recipientLineUserId: partner.lineUserId }),
    ]);
    partnerWishState.pendingByUser[lineUserId] = wishes.map((w) => w.id);

    const lines = [`🎁 ของขวัญสำหรับ ${partner.displayName}`, '', `✨ ที่${partner.displayName}อยากได้:`];
    lines.push(...(wishes.length ? wishes.map((w, i) => `${i + 1}. ${w.title}${fmtPrice(w.price)}`) : [`(ยังไม่ได้จด — ให้${partner.displayName}พิมพ์ อยากได้ ...)`]));
    lines.push('', '📜 เคยให้ไปแล้ว (อย่าซื้อซ้ำ):');
    lines.push(...(given.length ? given.slice(0, 5).map((g) => `• ${g.title}${fmtPrice(g.price)} — ${thaiDay(g.createdAt)}`) : ['(ยังไม่มี)']));
    if (wishes.length) lines.push('', 'ให้แล้ว: แตะปุ่ม 🎁 หรือพิมพ์ ให้ของขวัญแฟน [เลข]');

    return {
      type: 'partner_gifts',
      reply: lines.join('\n'),
      quickReplies: wishes.slice(0, MAX_BUTTONS).map((w, i) => ({ label: `🎁 ${i + 1}. ${w.title}`, text: `ให้ของขวัญแฟน ${i + 1}` })),
    };
  });
}

// "ให้ของขวัญแฟน 2" (เลขจากลิสต์ wishlist แฟน) หรือ "ให้ของขวัญแฟน นาฬิกา 2500 [ยืนยัน]"
function handleGiveGift(input, lineUserId) {
  return guarded(async () => {
    const { me, partner } = await couple(lineUserId);
    if (!me || !partner) return NEED_BOTH;

    const confirmed = /\s*ยืนยัน$/.test(input);
    const body = input.replace(/\s*ยืนยัน$/, '').trim();
    let title;
    let price;
    let wish = null;

    if (/^\d+$/.test(body)) {
      const snapshot = partnerWishState.pendingByUser[lineUserId];
      if (!snapshot) return { type: 'noop', reply: 'ยังไม่มีลิสต์ พิมพ์ ของขวัญแฟน เพื่อดู wishlist ก่อน' };
      const id = snapshot[Number(body) - 1];
      if (!id) return { type: 'error', reply: `ไม่พบรายการเลข ${body} (เลือกเลข 1-${snapshot.length})` };
      wish = (await listWishItems({ ownerLineUserId: partner.lineUserId })).find((w) => w.id === id);
      if (!wish) return { type: 'error', reply: 'รายการนี้ถูกให้หรือลบไปแล้ว', quickReplies: [{ label: '🎁 ดูใหม่', text: 'ของขวัญแฟน' }] };
      ({ title, price } = wish);
    } else {
      ({ title, price } = parseTitlePrice(body));
      if (!title) return { type: 'error', reply: 'ระบุของขวัญด้วย เช่น ให้ของขวัญแฟน นาฬิกา 2500' };
    }

    // กันซื้อซ้ำ: เคยให้ของคล้ายกันแล้ว ต้องพิมพ์ ยืนยัน
    const previous = (await listGifts({ recipientLineUserId: partner.lineUserId })).find((g) => similar(g.title, title));
    if (previous && !confirmed) {
      return {
        type: 'gift_duplicate',
        reply: `⚠️ เคยให้ "${previous.title}"${fmtPrice(previous.price)} ไปแล้วเมื่อ ${thaiDay(previous.createdAt)}\nแน่ใจว่าจะให้ "${title}" อีก?`,
        quickReplies: [{ label: 'ให้อีกครั้ง', text: `ให้ของขวัญแฟน ${body} ยืนยัน` }, { label: 'ไม่เอา', text: 'ของขวัญแฟน' }],
      };
    }

    await addGift({ giverLineUserId: lineUserId, recipientLineUserId: partner.lineUserId, title, price });
    // ปิด wishlist ที่ตรงกัน (รายการที่เลือกเอง + รายการที่ชื่อคล้ายกัน)
    const open = await listWishItems({ ownerLineUserId: partner.lineUserId });
    for (const w of open) if (w.id === wish?.id || similar(w.title, title)) await markWishGiven(w.id);

    return {
      type: 'gift_given',
      reply: [`🎁 บันทึกแล้ว: ให้ ${partner.displayName} — ${title}${fmtPrice(price)}`, 'ถ้าต้องการบันทึกเป็นค่าใช้จ่ายด้วย พิมพ์ เช่น ค่าของขวัญ 1200 ส่วนตัว'].join('\n'),
      quickReplies: [{ label: '📜 ประวัติของขวัญ', text: 'ประวัติของขวัญ' }],
    };
  });
}

function handleGiftHistory(lineUserId) {
  return guarded(async () => {
    const { me, partner } = await couple(lineUserId);
    if (!me || !partner) return NEED_BOTH;
    const all = (await listGifts()).filter((g) => [g.giverLineUserId, g.recipientLineUserId].includes(lineUserId));
    if (!all.length) return { type: 'gift_history', reply: 'ยังไม่มีประวัติของขวัญ\nบันทึกด้วย: ให้ของขวัญแฟน นาฬิกา 2500' };
    const lines = all.slice(0, 15).map((g) => `• ${thaiDay(g.createdAt)} ${g.giverLineUserId === lineUserId ? `ให้${partner.displayName}` : `ได้จาก${partner.displayName}`}: ${g.title}${fmtPrice(g.price)}`);
    return { type: 'gift_history', reply: ['📜 ประวัติของขวัญ (ล่าสุดก่อน)', ...lines].join('\n') };
  });
}

module.exports = { handleAddWish, handleMyWishlist, handleDeleteWish, handlePartnerGifts, handleGiveGift, handleGiftHistory, similar, parseTitlePrice };
