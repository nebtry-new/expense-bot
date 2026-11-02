// ร้านอาหารที่อยากไป: วางลิงก์ Google Maps → บอตเก็บชื่อ/พิกัด → สุ่มเลือก (ข้ามร้านที่ไปแล้ว)
// ต้องมีคำสั่งนำหน้า (เพิ่มร้าน …) เพราะลิงก์ Maps เปล่าๆ ถูกใช้ใน flow หาจุดชาร์จ EV
const { addRestaurant, listRestaurants, deleteRestaurant, markRestaurantVisited } = require('../../services/db');
const { restaurantListState, restaurantPickState } = require('../state');
const { extractMapsLink, resolveMapsPlace } = require('../../utils/maps-place');

const MAX_BUTTONS = 11; // + ปุ่ม สุ่มร้าน = 12 (ขีดจำกัด quick reply 13)
const MIGRATION_HINT = 'ยังใช้ฟีเจอร์นี้ไม่ได้ — ต้องรัน supabase/migration_013_restaurants_gifts.sql ใน Supabase ก่อน';

let random = Math.random;
function __setRandom(fn) { random = fn || Math.random; } // test hook

async function guarded(fn) {
  try {
    return await fn();
  } catch (error) {
    console.error('RESTAURANT_COMMAND_FAILED', error?.message || error);
    return { type: 'error', reply: MIGRATION_HINT };
  }
}

// ปุ่มเปิดคีย์บอร์ดพร้อม "เพิ่มร้าน " — วางลิงก์/พิมพ์ชื่อต่อได้ทันที เพิ่มต่อเนื่องได้เรื่อยๆ
const ADD_MORE = { label: '➕ เพิ่มร้านอีก', fillIn: 'เพิ่มร้าน ' };

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');
const withLink = (r) => (r.url ? `\n📍 ${r.url}` : '');

function parseNumbers(input) {
  const out = [];
  for (const m of String(input).matchAll(/(\d+)(?:\s*(?:-|ถึง)\s*(\d+))?/g)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (to < from || to - from > 30) return null;
    for (let i = from; i <= to; i += 1) if (!out.includes(i)) out.push(i);
  }
  return out;
}

function handleAddRestaurant(input, lineUserId) {
  return guarded(async () => {
    const usage = 'เพิ่มร้าน [ลิงก์ Google Maps] เช่น เพิ่มร้าน https://maps.app.goo.gl/xxxx (หรือเพิ่มชื่อเอง: เพิ่มร้าน ต้มยำกุ้ง [ลิงก์])';
    const link = extractMapsLink(input);
    const typed = String(input).replace(link || '', ' ').replace(/\s{2,}/g, ' ').trim();

    let name = typed;
    let place = null;
    if (link) {
      place = await resolveMapsPlace(link);
      name = typed || place?.name || '';
      if (!name) return { type: 'error', reply: `อ่านชื่อร้านจากลิงก์ไม่ได้ ระบุชื่อต่อท้ายด้วย เช่น เพิ่มร้าน ต้มยำกุ้ง ${link}`, quickReplies: [{ label: '➕ ลองใหม่', fillIn: `เพิ่มร้าน ชื่อร้าน ${link}` }] };
    }
    if (!name) return { type: 'error', reply: `ระบุลิงก์หรือชื่อร้านด้วย — ${usage}` };

    const existing = await listRestaurants();
    const dup = existing.find((r) => norm(r.name) === norm(name));
    if (dup) return { type: 'noop', reply: `มีร้าน "${dup.name}" อยู่ในลิสต์แล้ว`, quickReplies: [ADD_MORE, { label: '🎲 สุ่มร้าน', text: 'สุ่มร้าน' }] };

    const r = await addRestaurant({ name, url: place?.url || link || null, lat: place?.lat ?? null, lng: place?.lng ?? null, lineUserId });
    return {
      type: 'restaurant_added',
      reply: `🍽 เพิ่มร้าน: ${r.name}${withLink(r)}\nตอนนี้มี ${existing.length + 1} ร้านในลิสต์`,
      quickReplies: [ADD_MORE, { label: '🎲 สุ่มร้าน', text: 'สุ่มร้าน' }, { label: '📋 ดูร้านทั้งหมด', text: 'ร้านอาหาร' }],
    };
  });
}

function handleListRestaurants(lineUserId) {
  return guarded(async () => {
    const all = await listRestaurants();
    if (!all.length) {
      delete restaurantListState.pendingByUser[lineUserId];
      return { type: 'restaurants', reply: 'ยังไม่มีร้านในลิสต์\nเพิ่มได้ด้วย: เพิ่มร้าน [ลิงก์ Google Maps]' };
    }
    const rows = [...all.filter((r) => !r.visitedAt), ...all.filter((r) => r.visitedAt)];
    restaurantListState.pendingByUser[lineUserId] = rows.map((r) => r.id);

    const lines = rows.map((r, i) => `${i + 1}. ${r.visitedAt ? '✅ ' : ''}${r.name}`);
    const unvisited = rows.filter((r) => !r.visitedAt).length;
    const buttons = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !r.visitedAt)
      .slice(0, MAX_BUTTONS)
      .map(({ r, i }) => ({ label: `✓ ${i + 1}. ${r.name}`, text: `ร้านไปแล้ว ${i + 1}` }));
    return {
      type: 'restaurants',
      reply: [`🍽 ร้านอาหารที่อยากไป (ยังไม่ได้ไป ${unvisited}/${rows.length})`, ...lines, '', 'ไปแล้ว: แตะปุ่ม ✓ หรือพิมพ์ ร้านไปแล้ว [เลข] · ลบ: ลบร้าน [เลข]'].join('\n'),
      quickReplies: [{ label: '🎲 สุ่มร้าน', text: 'สุ่มร้าน' }, ...buttons],
    };
  });
}

function handleRandomRestaurant(keyword, lineUserId) {
  return guarded(async () => {
    const kw = norm(keyword || '');
    const all = (await listRestaurants()).filter((r) => !kw || norm(r.name).includes(kw));
    if (!all.length) {
      return { type: 'noop', reply: kw ? `ไม่พบร้านที่ชื่อมี "${keyword}"` : 'ยังไม่มีร้านในลิสต์\nเพิ่มได้ด้วย: เพิ่มร้าน [ลิงก์ Google Maps]' };
    }
    const unvisited = all.filter((r) => !r.visitedAt);
    const pool = unvisited.length ? unvisited : all;

    // ไม่สุ่มซ้ำร้านเดิมที่เพิ่งได้ ถ้ายังมีตัวเลือกอื่น
    const last = restaurantPickState.pendingByUser[lineUserId];
    const choices = pool.length > 1 ? pool.filter((r) => r.id !== last) : pool;
    const pick = choices[Math.min(Math.floor(random() * choices.length), choices.length - 1)];
    restaurantPickState.pendingByUser[lineUserId] = pick.id;

    const again = kw ? `สุ่มร้าน ${keyword}` : 'สุ่มร้าน';
    return {
      type: 'restaurant_pick',
      reply: [`🎲 วันนี้ไปกิน: ${pick.name}${withLink(pick)}`, unvisited.length ? `(สุ่มจาก ${pool.length} ร้านที่ยังไม่ได้ไป)` : '(ไปครบทุกร้านแล้ว สุ่มจากทุกร้านแทน)'].join('\n'),
      quickReplies: [{ label: '🎲 สุ่มใหม่', text: again }, { label: '✓ ไปกินแล้ว', text: 'ไปกินแล้ว' }, { label: '📋 ดูทั้งหมด', text: 'ร้านอาหาร' }],
    };
  });
}

// "ไปกินแล้ว" = ร้านที่เพิ่งสุ่มได้ · "ร้านไปแล้ว 2" = เลขจากลิสต์ที่เพิ่งแสดง
function handleVisitedRestaurant(input, lineUserId) {
  return guarded(async () => {
    let ids;
    if (input == null) {
      const id = restaurantPickState.pendingByUser[lineUserId];
      if (!id) return { type: 'noop', reply: 'ยังไม่ได้สุ่มร้าน พิมพ์ สุ่มร้าน ก่อน หรือใช้ ร้านไปแล้ว [เลข] จากลิสต์ร้านอาหาร' };
      ids = [id];
    } else {
      const numbers = parseNumbers(input);
      const snapshot = restaurantListState.pendingByUser[lineUserId];
      if (!numbers?.length) return { type: 'error', reply: 'ระบุเลขร้าน เช่น ร้านไปแล้ว 2 (ดูเลขจาก ร้านอาหาร)' };
      if (!snapshot) return { type: 'noop', reply: 'ยังไม่มีลิสต์ พิมพ์ ร้านอาหาร เพื่อดูรายการก่อน' };
      const bad = numbers.filter((n) => n < 1 || n > snapshot.length);
      if (bad.length) return { type: 'error', reply: `ไม่พบร้านเลข ${bad.join(', ')} (เลือกเลข 1-${snapshot.length})` };
      ids = numbers.map((n) => snapshot[n - 1]);
    }

    const all = await listRestaurants();
    const done = [];
    for (const id of ids) {
      const r = all.find((x) => x.id === id);
      if (r && (await markRestaurantVisited(id))) done.push(r);
    }
    delete restaurantPickState.pendingByUser[lineUserId];
    if (!done.length) return { type: 'noop', reply: 'ร้านนี้ถูกทำเครื่องหมายหรือลบไปแล้ว', quickReplies: [{ label: '📋 ดูทั้งหมด', text: 'ร้านอาหาร' }] };
    return {
      type: 'restaurant_visited',
      reply: `✅ ไปกินแล้ว: ${done.map((r) => r.name).join(', ')}\nรอบหน้าจะไม่สุ่มร้านนี้ (จนกว่าจะไปครบทุกร้าน)`,
      quickReplies: [{ label: '🎲 สุ่มร้านต่อไป', text: 'สุ่มร้าน' }],
    };
  });
}

function handleDeleteRestaurant(input, lineUserId) {
  return guarded(async () => {
    const numbers = parseNumbers(input);
    const snapshot = restaurantListState.pendingByUser[lineUserId];
    if (!numbers?.length) return { type: 'error', reply: 'ระบุเลขร้าน เช่น ลบร้าน 2 (ดูเลขจาก ร้านอาหาร)' };
    if (!snapshot) return { type: 'noop', reply: 'ยังไม่มีลิสต์ พิมพ์ ร้านอาหาร เพื่อดูรายการก่อน' };
    const bad = numbers.filter((n) => n < 1 || n > snapshot.length);
    if (bad.length) return { type: 'error', reply: `ไม่พบร้านเลข ${bad.join(', ')} (เลือกเลข 1-${snapshot.length})` };

    const all = await listRestaurants();
    const removed = [];
    for (const n of numbers) {
      const r = all.find((x) => x.id === snapshot[n - 1]);
      if (r && (await deleteRestaurant(r.id))) removed.push(r);
    }
    delete restaurantPickState.pendingByUser[lineUserId];
    const rest = await handleListRestaurants(lineUserId);
    return {
      type: 'restaurant_deleted',
      reply: `${removed.length ? `🗑 ลบร้าน: ${removed.map((r) => r.name).join(', ')}` : 'ร้านนี้ถูกลบไปแล้ว'}\n\n${rest.reply}`,
      quickReplies: rest.quickReplies,
    };
  });
}

module.exports = { handleAddRestaurant, handleListRestaurants, handleRandomRestaurant, handleVisitedRestaurant, handleDeleteRestaurant, __setRandom };
