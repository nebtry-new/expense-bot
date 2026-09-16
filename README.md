# Expense Bot

LINE chatbot สำหรับคู่รักเพื่อบันทึกค่าใช้จ่ายร่วมกันและคำนวณว่าใครต้องจ่ายให้ใคร

## Features

- ลงทะเบียนผู้ใช้จาก LINE
- บันทึกค่าใช้จ่ายแบบข้อความ
- รองรับ split mode:
  - half
  - none
  - custom
  - per_head
- สรุปยอดคงค้าง/หนี้ที่ต้องชำระ
- ใช้ Supabase เป็นฐานข้อมูล
- ใช้ Claude API สำหรับ slip OCR (ใน Sprint ต่อไป)

## Tech Stack

- Node.js
- Express
- LINE Messaging API SDK
- Supabase PostgreSQL
- Anthropic Claude API

## Project Structure

```text
expense-bot/
├── src/
│   ├── index.js
│   ├── handlers/
│   │   ├── message.js
│   │   ├── slip.js
│   │   └── text.js
│   ├── services/
│   │   ├── claude.js
│   │   └── db.js
│   └── utils/
│       ├── balance.js
│       └── parser.js
├── supabase/
│   └── schema.sql
├── test/
│   ├── balance.test.js
│   ├── commands.test.js
│   └── parser.test.js
├── .env.example
├── .dockerignore
├── Dockerfile
├── railway.json
├── package.json
├── README.md
└── CLAUDE.md
```

## Setup

1. Install dependencies

```bash
npm install
```

2. Copy environment file

```bash
cp .env.example .env
```

3. Fill in required values

```env
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
PORT=3000
```

4. Run locally

```bash
npm start
```

## Local Development

```bash
npm run dev
```

## Test

```bash
npm test
```

## Database

Schema is in:

```bash
supabase/schema.sql
```

You can also inspect DB status with:

```bash
npm run db:check
```

## Example Commands

When using LINE chat:

- `ลงทะเบียน ปิ๊ก`
- `ค่าอาหาร 350`
- `ค่าเดินทาง 800 หาร 2 คน`
- `สรุป`
- `help`
- `reset-all`
- `reset-confirm`
- `terminate user ปิ๊ก`
- `restore user ปิ๊ก`

## User lifecycle and reset commands

This bot is designed for exactly two active users only.

- `reset-all`: starts a full reset flow and asks for confirmation
- `reset-confirm`: confirms and clears all active user/expense data
- `terminate user <name>`: soft-disables a user
- `restore user <name>`: reactivates a terminated user

Safety rule:

- Never allow a third active user to register
- A reset requires explicit confirmation before clearing the system
- User termination keeps a historical record instead of hard-deleting immediately

## Deploy to Railway

1. Push this repo to GitHub
2. Import the repo in Railway
3. Add the environment variables from `.env`
4. Deploy
5. Set webhook URL to:

```text
https://<your-railway-app>.up.railway.app/webhook
```

## Notes

This project is built for a couple-user workflow, with the assumption that only two users interact with the bot.

