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
