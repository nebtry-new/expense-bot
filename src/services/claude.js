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
    content: `ค้นหาจุดชาร์จ EV ทุกสถานีบนเส้นทาง "${originText}" → "${destText}" ในระยะ ${reachableKm} กม.
ค้นหา EA Anywhere, PEA Volta, PTT EV และเครือข่ายอื่นๆ

ตอบเป็น JSON array เท่านั้น ห้ามมีข้อความอื่นนอกจาก JSON:
[{"name":"ชื่อสถานี","provider":"EA","numChargers":8,"distanceKm":65,"mapsLink":"https://..."}]

- distanceKm คือระยะห่างจากต้นทางตามถนนจริง (กม.)
- numChargers คือจำนวนหัวชาร์จหรือตู้ชาร์จ
- หาให้ครบที่สุดเท่าที่จะหาได้`,
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

  const raw = response.content.find((b) => b.type === 'text')?.text || '';

  // Parse structured JSON from Claude, apply distance-based selection logic
  let stations = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) stations = JSON.parse(match[0]);
  } catch {
    // JSON parse failed — return raw text as fallback
    return raw || 'ไม่พบข้อมูลจุดชาร์จ';
  }

  if (!stations.length) return raw || 'ไม่พบข้อมูลจุดชาร์จ';

  // Prefer stations where battery has dropped >50% of remaining range
  // (worth stopping vs. stations that are too close to origin)
  const halfKm = reachableKm * 0.5;
  const preferred = stations.filter((s) => Number(s.distanceKm) >= halfKm);
  const early = stations.filter((s) => Number(s.distanceKm) < halfKm);

  const byChargers = (a, b) => Number(b.numChargers) - Number(a.numChargers);
  const top5 = [
    ...preferred.sort(byChargers),
    ...early.sort(byChargers),
  ].slice(0, 5);

  const lines = top5.map((s, i) => {
    const dist = s.distanceKm ? `ห่าง ~${s.distanceKm} กม.` : '';
    const chargers = s.numChargers ? `${s.numChargers} ตู้` : '';
    const meta = [dist, chargers].filter(Boolean).join(' | ');
    return `${i + 1}. ${s.name} (${s.provider})${meta ? `\n   ${meta}` : ''}\n   ${s.mapsLink || ''}`;
  });

  return lines.join('\n\n');
}

module.exports = { analyzeSlip, searchEvStations };
