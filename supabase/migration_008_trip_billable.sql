-- Trip billing state: ทริปที่ is_billable = false จะไม่ถูกรวมใน "สรุป" ทั่วไป
-- ใช้คำสั่ง "ปิดทริป (ชื่อ)" เพื่อตั้งเป็น true / "เปิดทริป (ชื่อ)" เพื่อกลับเป็น false
ALTER TABLE trips ADD COLUMN IF NOT EXISTS is_billable boolean DEFAULT false;

-- ทริปที่มีอยู่แล้วคงพฤติกรรมเดิม (รวมใน สรุป)
UPDATE trips SET is_billable = true;
