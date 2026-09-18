const express = require('express');
const line = require('@line/bot-sdk');
const dotenv = require('dotenv');
const { handleTextMessage } = require('./handlers/text');
const { getUsers, getExpenses, getDbStatus } = require('./services/db');
const { runPendingNotifications } = require('./services/notifications');
const { analyzeSlip } = require('./services/claude');
const { slipConfirmState } = require('./handlers/state');
const { handleLocationForEv } = require('./handlers/commands/ev');
const { evRouteState, datetimePickerState } = require('./handlers/state');
const { parseDatetimePickerValue, toLocalDisplay } = require('./utils/parse-date');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

const LineClient = line.messagingApi?.MessagingApiClient || line.LineBotClient || line.Client;
const LineBlobClient = line.messagingApi?.MessagingApiBlobClient;

const lineClient = lineConfig.channelAccessToken
  ? new LineClient({ channelAccessToken: lineConfig.channelAccessToken })
  : null;

const lineBlobClient = lineConfig.channelAccessToken && LineBlobClient
  ? new LineBlobClient({ channelAccessToken: lineConfig.channelAccessToken })
  : null;

async function getImageBase64(messageId) {
  if (!lineBlobClient) throw new Error('LINE blob client not configured');
  const stream = await lineBlobClient.getMessageContent(messageId);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('base64');
}

async function sendReplyMessage(event, textOrMessage) {
  if (!lineClient || !event?.replyToken) return;
  try {
    const messages = typeof textOrMessage === 'string'
      ? [{ type: 'text', text: textOrMessage }]
      : [textOrMessage];
    await lineClient.replyMessage({ replyToken: event.replyToken, messages });
  } catch (error) {
    console.error('LINE replyMessage failed:', error?.response?.data || error.message || error);
  }
}

async function sendPushMessage(toUserId, text) {
  if (!lineClient || !toUserId) return;
  try {
    await lineClient.pushMessage({ to: toUserId, messages: [{ type: 'text', text }] });
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

app.post('/internal/run-notifications', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runPendingNotifications(sendPushMessage);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('run-notifications failed:', error.message);
    res.status(500).json({ error: error.message });
  }
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
      const lineUserId = event.source?.userId || 'unknown';
      const userContext = { lineUserId };

      // Detect EV battery reply that will trigger a slow web_search
      const evPending = evRouteState.pendingByUser[lineUserId];
      const containsMapsUrl = /https?:\/\/(www\.google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)/.test(messageText);
      const isEvBatteryReply = evPending && !containsMapsUrl && (
        /^\d+%?$/.test(messageText.trim()) ||
        (evPending.type === 'location' && evPending.destination && /^\d+%?$/.test(messageText.trim()))
      );

      if (isEvBatteryReply) {
        // Reply immediately so user knows bot is working, then push result
        await sendReplyMessage(event, 'กำลังค้นหาจุดชาร์จ EV...');
        const result = await handleTextMessage(messageText, userContext);
        await sendPushMessage(lineUserId, result.reply);
      } else {
        const result = await handleTextMessage(messageText, userContext);
        const replyPayload = result.replyMessage || result.reply;
        replies.push(typeof replyPayload === 'string' ? { type: 'text', text: replyPayload } : replyPayload);
        await sendReplyMessage(event, replyPayload);

        if (result.tripNotify) {
          const allUsers = await getUsers();
          for (const u of allUsers) {
            if (u.lineUserId && u.lineUserId !== lineUserId) {
              await sendPushMessage(u.lineUserId, result.tripNotify);
            }
          }
        }

        if (result.type === 'settlement_trigger' && result.notification?.debtorLineUserId) {
          const settlementText = `สรุปยอด: ${result.notification.debtorName} ต้องจ่าย ${result.notification.amount.toFixed(2)} บาท ให้ ${result.notification.creditorName}`;
          await sendPushMessage(result.notification.debtorLineUserId, settlementText);
        }

        if (result.type === 'payment_sent' && result.notification?.creditorLineUserId) {
          const pushText = `${result.notification.debtorName} แจ้งว่าโอนเงิน ${result.notification.amount.toFixed(2)} บาท แล้ว — พิมพ์ รับแล้ว เพื่อยืนยันและเคลียร์ยอด`;
          await sendPushMessage(result.notification.creditorLineUserId, pushText);
        }
      }
    }

    if (event.type === 'message' && event.message?.type === 'location') {
      const lineUserId = event.source?.userId || 'unknown';
      const { latitude, longitude, address } = event.message;
      const result = handleLocationForEv(latitude, longitude, address, lineUserId);
      await sendReplyMessage(event, result.reply);
    }

    if (event.type === 'postback') {
      const lineUserId = event.source?.userId || 'unknown';
      const data = event.postback?.data || '';

      if (data === 'action=pick_notif_datetime') {
        const datetime = event.postback?.params?.datetime;
        if (datetime) {
          const scheduledAt = parseDatetimePickerValue(datetime);
          datetimePickerState.pendingByUser[lineUserId] = { scheduledAt };
          await sendReplyMessage(event, `⏰ เลือก ${toLocalDisplay(scheduledAt)} น. แล้ว\nพิมพ์ข้อความแจ้งเตือน\n(เติม ทั้งคู่ หรือ #ทริป ท้ายเพื่อแจ้งสองคน)`);
        }
      }
    }

    if (event.type === 'follow') {
      const greetingText = 'ยินดีต้อนรับ! 👋\nบอทนี้ใช้สำหรับบันทึกค่าใช้จ่ายร่วมกัน\n\nเริ่มใช้งาน พิมพ์ว่า ลงทะเบียน (เว้นวรรค) ตามด้วยชื่อ\nเช่น ลงทะเบียน ปิ๊ก\n\nพิมพ์ help เพื่อดูคู่มือการใช้งาน';
      await sendReplyMessage(event, greetingText);
    }

    if (event.type === 'message' && event.message?.type === 'image') {
      const lineUserId = event.source?.userId || 'unknown';

      try {
        const base64 = await getImageBase64(event.message.id);
        const slipResult = await analyzeSlip(base64);

        if (slipResult.amount <= 0) {
          await sendReplyMessage(event, 'ไม่พบยอดเงินใน slip กรุณาส่งรูปที่ชัดเจนกว่านี้');
        } else {
          const allUsers = await getUsers();
          const sender = allUsers.find((u) => u.lineUserId === lineUserId);

          slipConfirmState.pendingByUser[lineUserId] = {
            amount: slipResult.amount,
            description: slipResult.description,
            paidByUserId: sender?.id || lineUserId,
            paidByDisplayName: sender?.displayName || lineUserId,
          };

          const replyText = `พบยอด ${Number(slipResult.amount).toLocaleString()} บาท (${slipResult.description})\n\nบันทึกแบบไหน?\n• ใช่ — หารครึ่ง\n• ไม่หาร — ส่วนตัว\n• หาร 3 — หารตามจำนวนคน\n• ฉัน X แฟน Y — ระบุเอง\n• ยกเลิก — ไม่บันทึก`;
          replies.push({ type: 'text', text: replyText });
          await sendReplyMessage(event, replyText);
        }
      } catch (err) {
        console.error('Slip analysis failed:', err.message);
        await sendReplyMessage(event, 'เกิดข้อผิดพลาดในการอ่าน slip กรุณาลองใหม่อีกครั้ง');
      }
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
