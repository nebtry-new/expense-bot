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

  const cleaned = text
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

  const { senderName, partnerName } = userNames;
  const customKeywords = ['ฉัน', 'แฟน', 'me', 'partner', 'เธอ', 'เขา'];
  if (senderName) customKeywords.push(escapeRegex(senderName));
  if (partnerName) customKeywords.push(escapeRegex(partnerName));
  const customTriggerPattern = new RegExp(`(${customKeywords.join('|')})`, 'i');

  if (/(ส่วนตัว|ของขวัญ|ไม่หาร|private|personal)/i.test(cleaned)) {
    splitMode = 'none';
  } else if (customTriggerPattern.test(cleaned) && /\d/.test(cleaned)) {
    customAmounts = parseCustomSplit(cleaned, userNames, amount);
    if (customAmounts) {
      splitMode = 'custom';
    }
  }

  if (splitMode !== 'custom') {
    const perHeadMatch = cleaned.match(/(?:^|\s)(?:หาร|split)\s*(\d+)(?:\s*คน)?/i)
      ?? cleaned.match(/\d+\s*\/\s*(\d+)/);
    if (perHeadMatch) {
      numPeople = Number.parseInt(perHeadMatch[1], 10);
      splitMode = numPeople === 2 ? 'half' : 'per_head';
      if (splitMode === 'half') numPeople = null;
    }
  }

  let splitWarning = null;
  if (splitMode === 'half' && amountMatch?.[3]) {
    const rest = amountMatch[3].trim();
    if (rest) {
      const suffixNumbers = (rest.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      const suffixSum = suffixNumbers.reduce((s, n) => s + n, 0);
      if (suffixNumbers.length > 0 && Math.abs(suffixSum - amount) < 0.01) {
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
  };
}

module.exports = {
  parseExpenseText,
};
