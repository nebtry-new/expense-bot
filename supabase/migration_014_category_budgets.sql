-- งบรายเดือนต่อหมวดค่าใช้จ่าย (ของทั้งคู่ร่วมกัน) — ตั้งด้วย "ตั้งงบ อาหาร 5000"
-- category = key ใน src/utils/categories.js (food, transport, bills, ...)
-- บอตเตือนตอนบันทึกรายการที่ทำให้ยอดเดือนนี้ถึง 80% และเกิน 100% ของงบ
CREATE TABLE IF NOT EXISTS category_budgets (
  category      text PRIMARY KEY,
  monthly_limit numeric(10,2) NOT NULL CHECK (monthly_limit > 0),
  updated_at    timestamptz DEFAULT now()
);
