function calculateBalances(expenses = [], users = ['userA', 'userB']) {
  const normalUsers = Array.isArray(users) && users.length
    ? users.map((user) => {
        if (typeof user === 'string') return { id: user, displayName: user };
        return {
          id: String(user.id || 'unknown-user'),
          displayName: user.displayName || user.id || 'ผู้ใช้',
        };
      })
    : [{ id: 'userA', displayName: 'userA' }, { id: 'userB', displayName: 'userB' }];

  const validUsers = Array.from(new Map(normalUsers.map((user) => [String(user.id), user])).values());
  const userByKey = new Map(validUsers.map((user) => [String(user.id), user]));

  const net = Object.fromEntries(validUsers.map((user) => [String(user.id), 0]));

  for (const expense of expenses) {
    if (!expense || !expense.amount || expense.splitMode === 'none') {
      continue;
    }

    const payerKey = String(expense.paidByUserId ?? validUsers[0].id);
    const payerUser = userByKey.get(payerKey) ?? validUsers[0];
    const payerId = String(payerUser.id);
    const others = validUsers.filter((user) => String(user.id) !== payerId);

    if (expense.splitMode === 'half' || expense.splitMode === undefined) {
      const share = Number(expense.amount) / validUsers.length;
      net[payerId] += share * (validUsers.length - 1);
      for (const other of others) {
        net[String(other.id)] -= share;
      }
      continue;
    }

    if (expense.splitMode === 'per_head') {
      const people = Number(expense.numPeople || validUsers.length);
      const share = Number(expense.amount) / people;
      net[payerId] += share * Math.max(people - 1, 0);
      for (const other of others) {
        net[String(other.id)] -= share;
      }
      continue;
    }

    if (expense.splitMode === 'custom' && expense.customAmounts) {
      for (const user of validUsers) {
        const customShare = Number(
          expense.customAmounts[user.id] ??
          expense.customAmounts[user.displayName] ??
          0
        );
        if (String(user.id) === payerId) {
          net[String(user.id)] += customShare || Number(expense.amount) / validUsers.length;
        } else {
          net[String(user.id)] -= customShare || 0;
        }
      }
    }
  }

  return Object.fromEntries(validUsers.map((user) => [String(user.id), Number(net[String(user.id)] || 0)]));
}

module.exports = {
  calculateBalances,
};
