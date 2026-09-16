const Anthropic = require('@anthropic-ai/sdk');

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

async function analyzeSlip(imageBase64, mediaType = 'image/jpeg') {
  if (!client) {
    console.error('ANTHROPIC_API_KEY not configured');
    return { amount: 0, description: '' };
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: imageBase64 },
        },
        {
          type: 'text',
          text: 'นี่คือหน้าจอ slip โอนเงิน อ่านยอดที่โอนและชื่อผู้รับหรือรายละเอียด ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น รูปแบบ: {"amount": <ยอดโอนเป็นตัวเลข>, "description": "<ชื่อผู้รับหรือรายละเอียด>"} ถ้าไม่ใช่ slip หรือไม่พบยอด ให้ amount เป็น 0',
        },
      ],
    }],
  });

  const text = message.content[0]?.text?.trim() || '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        amount: Number(parsed.amount) || 0,
        description: String(parsed.description || 'slip โอนเงิน').trim(),
      };
    }
  } catch (err) {
    console.error('Failed to parse Claude slip response:', text, err.message);
  }

  return { amount: 0, description: '' };
}

module.exports = { analyzeSlip };
