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
    // Try direct parse first, then greedy regex (handles nested braces in description strings)
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) raw = JSON.parse(jsonMatch[0]);
    }
    if (raw) {
      return {
        amount: Number(raw.amount) || 0,
        description: String(raw.description || 'slip โอนเงิน').trim(),
      };
    }
  } catch (err) {
    console.error('Failed to parse Claude slip response:', text, err.message);
  }

  return { amount: 0, description: '' };
}

async function searchEvStations(originText, destText, batteryPct, maxRangeKm) {
  if (!client) {
    console.error('ANTHROPIC_API_KEY not configured');
    return 'ไม่สามารถค้นหาได้ กรุณาตั้งค่า ANTHROPIC_API_KEY';
  }

  const reachableKm = Math.round((batteryPct / 100) * maxRangeKm);

  const messages = [{
    role: 'user',
    content: `ค้นหาจุดชาร์จ EV บนเส้นทาง ${originText} → ${destText}
แบตเหลือ ${batteryPct}% รถวิ่งได้ ${maxRangeKm} กม./ชาร์จ (วิ่งได้อีก ~${reachableKm} กม.)
ค้นหา EA Anywhere, PEA Volta, PTT EV และเครือข่ายอื่นๆ ที่มีหลายตู้
ตอบเป็นภาษาไทย เลือก 5 จุดที่ดีที่สุด บอกชื่อ ผู้ให้บริการ จำนวนตู้ และ Google Maps link`,
  }];

  let response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages,
  });

  // Handle tool_use loop (Anthropic executes web_search server-side)
  while (response.stop_reason === 'tool_use') {
    messages.push({ role: 'assistant', content: response.content });
    const toolResults = response.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
    messages.push({ role: 'user', content: toolResults });
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
    });
  }

  return response.content.find((b) => b.type === 'text')?.text || 'ไม่พบข้อมูลจุดชาร์จ';
}

module.exports = { analyzeSlip, searchEvStations };
