function calculateBalances(expenses = [], users = ['userA', 'userB']) {
  const validUsers = (Array.isArray(users) ? users.filter(Boolean) : ['userA', 'userB']).length
    ? Array.from(new Set(Array.isArray(users) ? users.filter(Boolean) : ['userA', 'userB']))
    : ['userA', 'userB'];

  const net = Object.fromEntries(validUsers.map((name) => [name, 0]));

  for (const expense of expenses) {
    if (!expense || !expense.paidBy || !expense.amount || expense.splitMode === 'none') {
      continue;
    }

    const payer = validUsers.includes(expense.paidBy) ? expense.paidBy : validUsers[0];
    const others = validUsers.filter((name) => name !== payer);

    if (expense.splitMode === 'half' || expense.splitMode === undefined) {
      const share = Number(expense.amount) / validUsers.length;
      net[payer] += share * (validUsers.length - 1);
      for (const other of others) {
        net[other] -= share;
      }
      continue;
    }

    if (expense.splitMode === 'per_head') {
      const people = Number(expense.numPeople || validUsers.length);
      const share = Number(expense.amount) / people;
      net[payer] += share * Math.max(people - 1, 0);
      for (const other of others) {
        net[other] -= share;
      }
      continue;
    }

    if (expense.splitMode === 'custom' && expense.customAmounts) {
      for (const user of validUsers) {
        const customShare = Number(expense.customAmounts[user] ?? 0);
        if (user === payer) {
          net[user] += customShare || Number(expense.amount) / validUsers.length;
        } else {
          net[user] -= customShare || 0;
        }
      }
    }
  }

  return Object.fromEntries(validUsers.map((name) => [name, Number(net[name] || 0)]));
}

module.exports = {
  calculateBalances,
};
