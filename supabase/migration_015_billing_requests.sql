-- ข้อเสนอเรียกเก็บเงินที่ส่งให้ลูกหนี้แล้ว (หลังเจ้าหนี้ตอบ ใช่) — ใช้เตือนลูกหนี้ที่ยังไม่จ่ายหลัง 3 วัน และ 7 วัน (09:00 เวลาไทย)
-- resolved_at = จ่ายแล้ว/เจ้าหนี้ยืนยันแล้ว/ไม่มียอดค้างแล้ว → หยุดเตือน
CREATE TABLE IF NOT EXISTS billing_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debtor_line_user_id   text NOT NULL,
  creditor_line_user_id text,
  debtor_name           text,
  creditor_name         text,
  amount                numeric(10,2) NOT NULL,
  scope                 jsonb,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  reminded_3_at         timestamptz,
  reminded_7_at         timestamptz,
  resolved_at           timestamptz
);

CREATE INDEX IF NOT EXISTS idx_billing_requests_open
  ON billing_requests (debtor_line_user_id)
  WHERE resolved_at IS NULL;
