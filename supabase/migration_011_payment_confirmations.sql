-- สถานะ "ลูกหนี้แจ้งจ่ายแล้ว รอเจ้าหนี้กด รับแล้ว" — เดิมเก็บในหน่วยความจำ (หายเมื่อเซิร์ฟเวอร์รีสตาร์ท)
-- confirmed_at IS NULL = ยังรอยืนยัน; ตัวรันแจ้งเตือนส่งเตือนเจ้าหนี้ซ้ำทุกวัน 09:00 (เวลาไทย) จนกว่าจะยืนยัน
-- scope: ขอบเขตรายการที่ตกลงกัน { tripId, expenseIds } ใช้ตอนเคลียร์ยอด
CREATE TABLE IF NOT EXISTS payment_confirmations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creditor_line_user_id text NOT NULL,
  debtor_line_user_id   text,
  creditor_name         text,
  debtor_name           text,
  amount                numeric(10,2) NOT NULL,
  scope                 jsonb,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  last_reminded_at      timestamptz,
  confirmed_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_payment_confirmations_pending
  ON payment_confirmations (creditor_line_user_id)
  WHERE confirmed_at IS NULL;
