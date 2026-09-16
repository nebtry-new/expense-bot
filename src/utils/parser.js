function normalizeNumber(value) {
  return Number.parseFloat(String(value).replace(/,/g, '').trim());
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCustomSplit(text, userNames = {}, totalAmount = 0) {
  const { senderName, partnerName } = userNames;

  const meParts = ['ฉัน', 'me', 'i'];
  if (senderName) meParts.push(escapeRegex(senderName));

  const partnerParts = ['แฟน', 'partner', 'เธอ', 'เขา'];
  if (partnerName) partnerParts.push(escapeRegex(partnerName));

  const mePattern = new RegExp(`(?:${meParts.join('|')})\\s*(\\d+(?:\\.\\d+)?)`, 'i');
  const partnerPattern = new RegExp(`(?:${partnerParts.join('|')})\\s*(\\d+(?:\\.\\d+)?)`, 'i');

  const meMatch = text.match(mePattern);
  const partnerMatch = text.match(partnerPattern);

  if (meMatch && partnerMatch) {
    return { me: normalizeNumber(meMatch[1]), partner: normalizeNumber(partnerMatch[1]) };
  }

  if (meMatch && totalAmount) {
    const me = normalizeNumber(meMatch[1]);
    return { me, partner: totalAmount - me };
  }

  if (partnerMatch && totalAmount) {
    const partner = normalizeNumber(partnerMatch[1]);
    return { me: totalAmount - partner, partner };
  }

  return null;
}

function parseExpenseText(rawText = '', userNames = {}) {
  const text = String(rawText || '').trim();

  if (!text) {
    return {
      amount: 0,
      description: '',
      splitMode: 'half',
      numPeople: null,
      customAmounts: null,
    };
  }

  const tripTagMatch = text.match(/#([฀-๿a-zA-Z0-9_]+)/);
  const tripTag = tripTagMatch ? tripTagMatch[1] : null;

  const cleaned = text
    .replace(/#[฀-๿a-zA-Z0-9_]+/g, '')
    .replace(/[$฿]/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const amountMatch = cleaned.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(.*)$/);
  const amount = amountMatch ? normalizeNumber(amountMatch[2]) : 0;
  const description = amountMatch ? amountMatch[1].trim() : cleaned;

  let splitMode = 'half';
  let numPeople = null;
  let customAmounts = null;
  let splitExplicit = false;

  const { senderName, partnerName } = userNames;
  const customKeywords = ['ฉัน', 'แฟน', 'me', 'partner', 'เธอ', 'เขา'];
  if (senderName) customKeywords.push(escapeRegex(senderName));
  if (partnerName) customKeywords.push(escapeRegex(partnerName));
  const customTriggerPattern = new RegExp(`(${customKeywords.join('|')})`, 'i');

  if (/(ส่วนตัว|ของขวัญ|ไม่หาร|private|personal)/i.test(cleaned)) {
    splitMode = 'none';
    splitExplicit = true;
  } else if (customTriggerPattern.test(cleaned) && /\d/.test(cleaned)) {
    customAmounts = parseCustomSplit(cleaned, userNames, amount);
    if (customAmounts) {
      splitMode = 'custom';
      splitExplicit = true;
    }
  }

  if (splitMode !== 'custom') {
    const perHeadMatch = cleaned.match(/(?:^|\s)(?:หาร|split)\s*(\d+)(?:\s*คน)?/i)
      ?? cleaned.match(/\d+\s*\/\s*(\d+)/);
    if (perHeadMatch) {
      numPeople = Number.parseInt(perHeadMatch[1], 10);
      splitMode = numPeople === 2 ? 'half' : 'per_head';
      if (splitMode === 'half') numPeople = null;
      splitExplicit = true;
    }
  }

  let splitWarning = null;
  if (splitMode === 'half' && amountMatch?.[3]) {
    const rest = amountMatch[3].trim();
    if (rest) {
      const pairs = rest.match(/[฀-๿a-zA-Z]+\s*\d+(?:\.\d+)?/g) || [];
      const suffixNumbers = (rest.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      const suffixSum = suffixNumbers.reduce((s, n) => s + n, 0);
      // Require ≥2 word-number pairs to reduce false positives (e.g. "มิเตอร์ 200")
      if (pairs.length >= 2 && Math.abs(suffixSum - amount) < 0.01) {
        splitWarning = rest;
      }
    }
  }

  return {
    amount,
    description,
    splitMode,
    numPeople,
    customAmounts,
    splitWarning,
    splitExplicit,
    tripTag,
  };
}

function parseTripCreation(text) {
  const trimmed = text.trim();

  const perHeadMatch = trimmed.match(/^(.+?)\s+(?:หาร|split)\s*(\d+)(?:\s*คน)?$/i)
    ?? trimmed.match(/^(.+?)\s*\/\s*(\d+)$/);
  if (perHeadMatch) {
    const n = Number.parseInt(perHeadMatch[2], 10);
    return {
      name: perHeadMatch[1].trim(),
      defaultSplitMode: n === 2 ? 'half' : 'per_head',
      defaultNumPeople: n === 2 ? null : n,
    };
  }

  const noneMatch = trimmed.match(/^(.+?)\s+(ไม่หาร|ส่วนตัว|ของขวัญ|private|personal)$/i);
  if (noneMatch) {
    return { name: noneMatch[1].trim(), defaultSplitMode: 'none', defaultNumPeople: null };
  }

  return { name: trimmed, defaultSplitMode: 'half', defaultNumPeople: null };
}

function formatSplitMode(splitMode, numPeople) {
  if (splitMode === 'half') return 'หารครึ่ง';
  if (splitMode === 'none') return 'ส่วนตัว';
  if (splitMode === 'custom') return 'กำหนดเอง';
  if (splitMode === 'per_head') return `หาร ${numPeople || '?'} คน`;
  return splitMode || 'หารครึ่ง';
}

module.exports = {
  parseExpenseText,
  parseCustomSplit,
  parseTripCreation,
  formatSplitMode,
};
