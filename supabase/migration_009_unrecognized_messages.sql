-- ข้อความที่บอตตีความเป็นรายการค่าใช้จ่ายไม่ได้ (ไว้ดูแล้วเติมกฎ/ปรับ prompt)
CREATE TABLE IF NOT EXISTS unrecognized_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id text,
  text         text NOT NULL,
  reason       text,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS unrecognized_messages_created_at_idx ON unrecognized_messages (created_at DESC);
