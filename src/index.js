const express = require('express');
const line = require('@line/bot-sdk');
const dotenv = require('dotenv');
const { handleTextMessage } = require('./handlers/text');
const { getUsers, getExpenses, getDbStatus } = require('./services/db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

const LineClient = line.messagingApi?.MessagingApiClient || line.LineBotClient || line.Client;
const lineClient = lineConfig.channelAccessToken
  ? new LineClient({ channelAccessToken: lineConfig.channelAccessToken })
  : null;

async function sendReplyMessage(event, text) {
  if (!lineClient || !event?.replyToken) {
    return;
  }

  try {
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text }],
    });
  } catch (error) {
    console.error('LINE replyMessage failed:', error?.response?.data || error.message || error);
  }
}

async function sendPushMessage(toUserId, text) {
  if (!lineClient || !toUserId) {
    return;
  }

  try {
    await lineClient.pushMessage({
      to: toUserId,
      messages: [{ type: 'text', text }],
    });
  } catch (error) {
    console.error('LINE pushMessage failed:', error?.response?.data || error.message || error);
  }
}

if (lineConfig.channelSecret && lineConfig.channelAccessToken) {
  app.use('/webhook', line.middleware({
    channelAccessToken: lineConfig.channelAccessToken,
    channelSecret: lineConfig.channelSecret,
  }));
}

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'expense-bot' });
});

app.get('/debug-data', async (req, res) => {
  try {
    const users = await getUsers();
    const expenses = await getExpenses();
    res.json({
      db: getDbStatus(),
      tables: {
        users,
        expenses,
        expense_splits: [],
        monthly_summaries: [],
        trips: [],
      },
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load debug data',
      message: error.message,
    });
  }
});

app.post('/webhook', async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];

  if (!events.length) {
    return res.json({ ok: true, handled: 0 });
  }

  const replies = [];

  for (const event of events) {
    if (event.type === 'message' && event.message?.type === 'text') {
      const messageText = event.message.text;
      const userContext = {
        lineUserId: event.source?.userId || 'unknown',
      };

      const result = await handleTextMessage(messageText, userContext);
      replies.push({
        type: 'text',
        text: result.reply,
      });

      await sendReplyMessage(event, result.reply);

      if (result.type === 'settlement_trigger' && result.notification?.debtorLineUserId) {
        const settlementText = `สรุปยอด: ${result.notification.debtorName} ต้องจ่าย ${result.notification.amount.toFixed(2)} บาท ให้ ${result.notification.creditorName}`;
        await sendPushMessage(result.notification.debtorLineUserId, settlementText);
      }

      if (result.type === 'payment_sent' && result.notification?.creditorLineUserId) {
        const pushText = `${result.notification.debtorName} แจ้งว่าโอนเงิน ${result.notification.amount.toFixed(2)} บาท แล้ว — พิมพ์ รับแล้ว เพื่อยืนยันและเคลียร์ยอด`;
        await sendPushMessage(result.notification.creditorLineUserId, pushText);
      }
    }

    if (event.type === 'follow') {
      const greetingText = 'ยินดีต้อนรับ! 👋\nบอทนี้ใช้สำหรับบันทึกค่าใช้จ่ายร่วมกัน\n\nเริ่มใช้งาน พิมพ์ว่า ลงทะเบียน (เว้นวรรค) ตามด้วยชื่อ\nเช่น ลงทะเบียน ปิ๊ก\n\nพิมพ์ help เพื่อดูคู่มือการใช้งาน';
      await sendReplyMessage(event, greetingText);
    }

    if (event.type === 'message' && event.message?.type === 'image') {
      const replyText = 'รับรูป slip แล้ว แต่ยังไม่ทำ OCR แบบเต็มใน Sprint 1 ค่ะ';
      replies.push({
        type: 'text',
        text: replyText,
      });

      await sendReplyMessage(event, replyText);
    }
  }

  return res.json({ ok: true, handled: replies.length, replies });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Expense bot listening on port ${PORT}`);
  });
}

module.exports = { app };
