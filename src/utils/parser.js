function normalizeNumber(value) {
  return Number.parseFloat(String(value).replace(/,/g, '').trim());
}

function parseCustomSplit(text) {
  const meMatch = text.match(/(?:ฉัน|me|i)\s*(\d+(?:\.\d+)?)/i);
  const partnerMatch = text.match(/(?:แฟน|partner|เธอ|เขา)\s*(\d+(?:\.\d+)?)/i);

  if (meMatch && partnerMatch) {
    return {
      me: normalizeNumber(meMatch[1]),
      partner: normalizeNumber(partnerMatch[1]),
    };
  }

  return null;
}

function parseExpenseText(rawText = '') {
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

  if (/(ส่วนตัว|ของขวัญ|ไม่หาร|private|personal)/i.test(cleaned)) {
    splitMode = 'none';
  } else if (/(ฉัน|แฟน|me|partner|เธอ|เขา)/i.test(cleaned) && /\d/.test(cleaned)) {
    customAmounts = parseCustomSplit(cleaned);
    if (customAmounts) {
      splitMode = 'custom';
    }
  }

  if (splitMode !== 'custom') {
    const perHeadMatch = cleaned.match(/(?:หาร|split)\s*(\d+)\s*คน/i);
    if (perHeadMatch) {
      splitMode = 'per_head';
      numPeople = Number.parseInt(perHeadMatch[1], 10);
    }
  }

  return {
    amount,
    description,
    splitMode,
    numPeople,
    customAmounts,
  };
}

module.exports = {
  parseExpenseText,
};
