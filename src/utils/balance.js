function calculateBalances(expenses = [], users = ['userA', 'userB']) {
  const [userA, userB] = users;
  const net = {
    [userA]: 0,
    [userB]: 0,
  };

  for (const expense of expenses) {
    if (!expense || !expense.paidBy || !expense.amount || expense.splitMode === 'none') {
      continue;
    }

    const payer = users.includes(expense.paidBy) ? expense.paidBy : userA;
    const other = users.find((name) => name !== payer) || userB;

    if (expense.splitMode === 'half' || expense.splitMode === undefined) {
      const share = expense.amount / 2;
      net[payer] += share;
      net[other] -= share;
      continue;
    }

    if (expense.splitMode === 'per_head') {
      const people = Number(expense.numPeople || 2);
      const share = expense.amount / people;
      net[payer] += share * (people - 1);
      net[other] -= share;
      continue;
    }

    if (expense.splitMode === 'custom' && expense.customAmounts) {
      const payerShare = expense.customAmounts[payer] ?? expense.amount / 2;
      const otherShare = expense.customAmounts[other] ?? expense.amount - payerShare;
      net[payer] += payerShare;
      net[other] -= otherShare;
    }
  }

  return {
    [userA]: Number(net[userA] || 0),
    [userB]: Number(net[userB] || 0),
  };
}

module.exports = {
  calculateBalances,
};
