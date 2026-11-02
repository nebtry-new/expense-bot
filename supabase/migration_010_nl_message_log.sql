-- เก็บทุกข้อความที่ผ่านชั้นตีความภาษาธรรมชาติ (NL layer) ไว้วิเคราะห์ใน phase ถัดไป
-- route: code = โค้ดตัดสินเอง (ยืม/คืนเงิน), model = ส่งให้ Claude, none = ไม่ได้ตีความ (ข้อความยาวเกิน/ไม่มี key/rate limit)
-- outcome: saved | failed | rejected (AI ตีความได้แต่ตรวจไม่ผ่าน เช่น ไม่พบทริป)
-- expense_ids: รายการที่บันทึก — ถ้าภายหลัง id นี้หายจาก expenses แปลว่าถูกลบ (สัญญาณว่าตีความผิด)
CREATE TABLE IF NOT EXISTS nl_message_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id  text,
  text          text NOT NULL,
  route         text,
  model         text,
  outcome       text,
  reason        text,
  interpreted   jsonb,
  expense_ids   text[],
  has_date      boolean DEFAULT false,
  latency_ms    integer,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nl_message_log_created_at_idx ON nl_message_log (created_at DESC);
CREATE INDEX IF NOT EXISTS nl_message_log_route_outcome_idx ON nl_message_log (route, outcome);
