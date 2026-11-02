-- Sprint 3: วันสำคัญ (วนทุกปี) + To-Do ร่วมกัน
-- reminded_keys เก็บรอบที่ส่งเตือนไปแล้ว เช่น '2026:7' = ปี 2026 เตือนล่วงหน้า 7 วัน (กันส่งซ้ำ รอดการรีสตาร์ท)

CREATE TABLE IF NOT EXISTS special_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   text NOT NULL,
  month                   int NOT NULL CHECK (month BETWEEN 1 AND 12),
  day                     int NOT NULL CHECK (day BETWEEN 1 AND 31),
  year                    int,                         -- ปี ค.ศ. ที่เริ่ม (ไว้นับอายุ/ครบกี่ปี) ไม่ระบุได้
  kind                    text NOT NULL DEFAULT 'other', -- birthday | anniversary | other
  created_by_line_user_id text,
  reminded_keys           text[] NOT NULL DEFAULT '{}',
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS todos (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   text NOT NULL,
  due_date                date,                        -- วันครบกำหนด (วันที่ตามเวลาไทย) ไม่ระบุได้
  created_by_line_user_id text,
  created_by_name         text,
  done_at                 timestamptz,
  done_by_name            text,
  reminded_keys           text[] NOT NULL DEFAULT '{}',
  created_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_todos_open ON todos (due_date) WHERE done_at IS NULL;
