# expense-bot — CLAUDE.md

Context file สำหรับ Claude Code อ่านไฟล์นี้ก่อนทำงานทุกครั้ง

---

## โปรเจกต์คืออะไร

LINE Chatbot สำหรับคู่รัก ใช้บันทึกค่าใช้จ่ายร่วมกันและคำนวณว่าใครต้องจ่ายให้ใครเท่าไหร่
ใช้งานจริงแค่ 2 คน (เจ้าของกับแฟน)

---

## Tech Stack

| ส่วน | เครื่องมือ |
|---|---|
| Runtime | Node.js (JavaScript) |
| Framework | Express.js |
| LINE SDK | @line/bot-sdk v9 |
| AI / Vision | Claude API (claude-sonnet-4-6) |
| Database | Supabase (PostgreSQL) |
| Hosting | Railway (deployed ✅) |
| Local dev | ngrok |

---

## File Structure

```
expense-bot/
├── CLAUDE.md                 ← ไฟล์นี้
├── .env                      ← ต้องสร้างเอง (ดู .env.example)
├── .env.example
├── .gitignore
├── package.json
└── src/
    ├── index.js              ← Express server + LINE webhook
    ├── handlers/
    │   ├── message.js        ← route event → handler ที่ถูกต้อง
    │   ├── slip.js           ← รับรูป slip → Claude Vision → บันทึก
    │   └── text.js           ← parse คำสั่ง + คำนวณสรุปยอด
    ├── services/
    │   ├── claude.js         ← wrapper Claude API (vision)
    │   ├── db.js             ← Supabase queries ทั้งหมด
    │   └── ocm.js            ← Open Charge Map API + Nominatim geocoding
    └── utils/
        └── parser.js         ← parse text → split mode
```

---

## Database Schema (Supabase / PostgreSQL)

```sql
-- ผู้ใช้งาน (ควรมีแค่ 2 rows ตลอด)
users (
  id            uuid PK,
  line_user_id  text UNIQUE,   -- LINE userId
  display_name  text,
  created_at    timestamptz
)

-- ค่าใช้จ่ายแต่ละรายการ
expenses (
  id          uuid PK,
  paid_by     uuid FK → users,
  trip_id     uuid FK → trips (nullable),
  amount      decimal(10,2),
  description text,
  category    text default 'other',
  split_mode  text CHECK (split_mode IN ('half','none','custom','per_head')),
  num_people  int (nullable — ใช้เฉพาะ per_head),
  is_cleared  boolean default false,
  slip_url    text (nullable),
  created_at  timestamptz
)

-- รายละเอียด split สำหรับ custom และ per_head
expense_splits (
  id          uuid PK,
  expense_id  uuid FK → expenses ON DELETE CASCADE,
  user_id     uuid FK → users,
  amount      decimal(10,2)
)

-- สถานที่ในทริป (Sprint 2 — รัน migration_004 ก่อน deploy)
trip_places (
  id         uuid PK,
  trip_id    uuid FK → trips ON DELETE CASCADE,
  name       text NOT NULL,
  notes      text (nullable),
  created_at timestamptz
)

-- โปรไฟล์รถ EV (Sprint 2 — รัน migration_004 ก่อน deploy)
car_profile (
  id            uuid PK,
  max_range_km  int,
  updated_at    timestamptz
)

-- archive รายเดือน (Sprint 5 — ยังไม่ได้สร้าง table)
monthly_summaries (
  id          uuid PK,
  user_id     uuid FK → users,
  month       text,            -- เช่น "2026-09"
  total_paid  decimal(10,2),
  total_owed  decimal(10,2),
  cleared_at  timestamptz
)

-- ทริปท่องเที่ยว
trips (
  id                  uuid PK,
  name                text,
  default_split_mode  text default 'half',
  default_num_people  int (nullable),
  created_at          timestamptz
)
```

---

## Split Mode Logic

| split_mode | ความหมาย | trigger keyword | expense_splits |
|---|---|---|---|
| `half` | หาร 2 เท่ากัน (default) | ไม่มี keyword | ไม่สร้าง |
| `none` | ส่วนตัว ไม่หาร | "ส่วนตัว", "ของขวัญ", "ไม่หาร" | ไม่สร้าง |
| `custom` | ระบุจำนวนเอง | "ฉัน X แฟน Y" | สร้าง 2 rows |
| `per_head` | หารตามจำนวนคน | "หาร X คน" | สร้าง 2 rows |

---

## การระบุเจ้าของรายการ

1. ใครส่ง message → LINE API บอก `userId` → บันทึกเป็นคนจ่าย (อัตโนมัติ)
2. พิมพ์ระบุชื่อ เช่น "แฟนออกค่าที่พัก 1200" → parse จาก text
3. ถ้า userId ไม่ match → bot ถาม "ใครจ่ายคะ?"

---

## Backlog

### Sprint 1 — MVP ✅ เสร็จแล้ว

| # | Item | Status |
|---|---|---|
| 1 | ส่งรูป slip → อ่านยอดด้วย Claude Vision → บันทึก half อัตโนมัติ | ✅ done |
| 2 | พิมพ์บันทึกค่าใช้จ่าย + parse split mode ทุกแบบ | ✅ done |
| 3 | สรุปยอดและคำนวณส่วนแบ่งตาม split mode | ✅ done |

**เพิ่มเติมจาก Sprint 1 (done):**
- ✅ Settlement flow — จ่ายแล้ว / รับแล้ว + debtor guard
- ✅ Trip system — สร้างทริป, default split mode, #tag, สรุปทริป + เรียกเก็บเงิน
- ✅ Multi-line batch expense + shared #tag propagation
- ✅ Slip override — หาร N, ฉัน X แฟน Y, ไม่หาร
- ✅ User management — ลงทะเบียน, เปลี่ยนชื่อ, ผู้ใช้, ป้องกันชื่อซ้ำ
- ✅ Deploy บน Railway

**รัน SQL migrations ใน Supabase ก่อน deploy ครั้งต่อไป:**
- `supabase/migration_001_add_soft_delete.sql`
- `supabase/migration_002_add_trip_id_to_expenses.sql`
- `supabase/migration_003_trip_default_split.sql`
- `supabase/migration_004_trip_places_car_profile.sql` ← Sprint 2

### Sprint 2 — Trip Assistant ✅ เสร็จแล้ว

- **Trip notebook** — บันทึกสถานที่ที่อยากไปต่อท้าย trip
- **EV charging route** — บอก A → B + % แบตที่เหลือ → แนะนำจุดชาร์จระหว่างทาง (เรียงตามจำนวนตู้, มี Google Maps link, ร้านอาหารใกล้เคียง) คำนวณให้เหลือ ≥ 20% เสมอ ใช้ Open Charge Map API + Anthropic web_search

### Sprint 3 — Reminders & To-Do (ยังไม่เริ่ม)

- **แจ้งเตือนวันพิเศษ** — บันทึก event (วันเกิด, ครบรอบ ฯลฯ) + reminder ล่วงหน้า + Claude generate ข้อความน่ารักวันนั้น
- **To-Do ร่วมกัน** — shared task list + due date + push reminder

### Sprint 4 — Discovery & Gifts (ยังไม่เริ่ม)

- **สุ่มร้านอาหาร** — paste Google Maps link → bot ดึงข้อมูลเอง → สุ่มเลือก
- **ของขวัญ** — wishlist ของแต่ละคน + gift history ป้องกันซ้ำ + bot hint ให้อีกฝ่ายตอนใกล้วันพิเศษ

### Sprint 5 — Data & Automation (ยังไม่เริ่ม)

- **แยกหมวดค่าใช้จ่าย** — AI auto-classify อัตโนมัติ (rule-based keyword → Claude fallback) ไม่ต้องพิมพ์เพิ่ม
- **สรุปรายเดือนแยกหมวด** — ดูยอดแต่ละหมวด + ตั้งงบ + แจ้งเตือนใกล้เกิน
- **Reminder ค้างชำระ** — push แจ้งเตือนอัตโนมัติถ้าไม่จ่ายภายใน 3 วัน / 7 วัน หลังเรียกเก็บ (ต้องย้าย settlement state ลง DB + cron)

### Sprint 6 — Nice to have (ยังไม่เริ่ม)

- **ฟีเจอร์ความสัมพันธ์** — จำรายละเอียดของแฟน (เช่น ไม่ทานถั่วงอก), แนะนำกิจกรรม, สถานที่ที่แฟนอยากไป, ดูดวง
- **บิลรายเดือนร่วมกัน**

---

## Environment Variables (.env)

```
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_SECRET_KEY=        ← sb_secret_... (ไม่ใช่ publishable key)
PORT=3000
```

---

## วิธี Run ระหว่าง Dev

```bash
# Terminal 1 — รัน bot
npm run dev

# Terminal 2 — เปิด tunnel ให้ LINE เข้าถึงได้
ngrok http 3000
```

เอา ngrok URL ไปใส่ที่ LINE Developers → Messaging API → Webhook URL
```
https://xxxx.ngrok-free.app/webhook
```

---

## วิธีทดสอบ (ลำดับนี้)

```
1. ทั้งคู่พิมพ์ "ลงทะเบียน ชื่อ" ก่อน
2. พิมพ์ "ค่าอาหาร 350" → ดูว่าบันทึกได้
3. ส่งรูป slip → ดูว่าอ่านยอดได้
4. พิมพ์ "สรุป" → ดูยอดรวม
```

---

## Decisions ที่ตัดสินใจไปแล้ว (ห้าม revert)

- ใช้ JavaScript ไม่ใช่ TypeScript (เหตุผล: timeline สั้น 2 สัปดาห์)
- ใช้ Supabase ไม่ใช่ Firebase (เหตุผล: schema เป็น relational ต้องการ JOIN และ SUM)
- `is_cleared` flag ใช้ manual clear ก่อน (Sprint 1) ระบบ confirm อัตโนมัติทำใน Sprint 2
- slip ที่ส่งมาโดยไม่มีข้อความเพิ่ม → default `split_mode = half` เสมอ
- ถ้าพิมพ์ text เพิ่มพร้อม slip → ส่งให้ parser.js จัดการเหมือน text ปกติ
- ระบบ settlement (จ่ายแล้ว/รับแล้ว) ทำเสร็จแล้วใน Sprint 1
