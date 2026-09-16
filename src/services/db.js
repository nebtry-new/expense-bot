const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const users = [];
const deletedUsers = [];
const expenses = [];
const resetState = {
  pendingReset: false,
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;
const developmentMode = String(process.env.DEVELOPMENT_MODE || '').toLowerCase() === 'true';
const supabase = supabaseUrl && supabaseKey && !developmentMode ? createClient(supabaseUrl, supabaseKey) : null;

function normalizeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    lineUserId: user.line_user_id || user.lineUserId,
    displayName: user.display_name || user.displayName || 'ผู้ใช้',
    createdAt: user.created_at || user.createdAt,
    isDeleted: Boolean(user.is_deleted ?? user.isDeleted ?? false),
  };
}

async function resetData() {
  if (supabase) {
    await supabase.from('expense_splits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  }

  users.length = 0;
  deletedUsers.length = 0;
  expenses.length = 0;
  resetState.pendingReset = false;
}

async function registerUser({ lineUserId, displayName }) {
  const currentUsers = supabase ? await getUsers() : [...users];

  if (currentUsers.length >= 2) {
    const error = new Error('ระบบรองรับผู้ใช้ได้สูงสุด 2 คนเท่านั้น');
    console.error('USER_REGISTRATION_BLOCKED', {
      lineUserId,
      displayName,
      currentUserCount: currentUsers.length,
      maxAllowed: 2,
    });
    throw error;
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .upsert({ line_user_id: lineUserId, display_name: displayName || 'ผู้ใช้' }, {
        onConflict: 'line_user_id',
      })
      .select();

    if (error) {
      throw error;
    }

    return normalizeUser(data?.[0]) || null;
  }

  const existing = users.find((user) => user.lineUserId === lineUserId);
  if (existing) {
    return existing;
  }

  const user = {
    id: `user_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    lineUserId,
    displayName: displayName || 'ผู้ใช้',
    createdAt: new Date().toISOString(),
    isDeleted: false,
  };

  users.push(user);
  return user;
}

async function findUserByLineId(lineUserId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('line_user_id', lineUserId)
      .limit(1);

    if (error) {
      throw error;
    }

    return normalizeUser(data?.[0]) || null;
  }

  return users.find((user) => user.lineUserId === lineUserId) || null;
}

async function getUsers() {
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*');
    if (error) {
      throw error;
    }

    return data
      .map((user) => normalizeUser(user))
      .filter((user) => user && !user.isDeleted);
  }

  return users.filter((user) => !user.isDeleted).map((user) => ({ ...user }));
}

async function terminateUserByName(displayName) {
  const currentUsers = await getUsers();
  const user = currentUsers.find((entry) => entry.displayName === displayName);

  if (!user) {
    return null;
  }

  if (supabase) {
    const { error } = await supabase
      .from('users')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', user.id);

    if (error) {
      throw error;
    }
  } else {
    const index = users.findIndex((entry) => entry.id === user.id);
    if (index >= 0) {
      users[index].isDeleted = true;
      deletedUsers.push({ ...users[index] });
    }
  }

  return user;
}

async function restoreUserByName(displayName) {
  const activeUsers = await getUsers();
  const activeUser = activeUsers.find((entry) => entry.displayName === displayName);

  if (activeUser) {
    return activeUser;
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('display_name', displayName)
      .limit(1);

    if (error) {
      throw error;
    }

    const priorUser = data?.[0];
    if (!priorUser) {
      return null;
    }

    const { error: restoreError } = await supabase
      .from('users')
      .update({ is_deleted: false, deleted_at: null })
      .eq('id', priorUser.id);

    if (restoreError) {
      throw restoreError;
    }

    return normalizeUser(priorUser);
  }

  const deletedUser = deletedUsers.find((entry) => entry.displayName === displayName);
  if (!deletedUser) {
    return null;
  }

  const userIndex = users.findIndex((entry) => entry.id === deletedUser.id);
  if (userIndex >= 0) {
    users[userIndex].isDeleted = false;
  }

  const deletedIndex = deletedUsers.findIndex((entry) => entry.id === deletedUser.id);
  if (deletedIndex >= 0) {
    deletedUsers.splice(deletedIndex, 1);
  }

  return { ...deletedUser, isDeleted: false };
}

async function addExpense(expense) {
  if (supabase) {
    const payload = {
      paid_by: expense.paidBy,
      amount: expense.amount,
      description: expense.description,
      category: expense.category || 'other',
      split_mode: expense.splitMode || 'half',
      num_people: expense.numPeople || null,
      is_cleared: false,
      slip_url: expense.slipUrl || null,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('expenses').insert(payload).select();
    if (error) {
      throw error;
    }

    return data?.[0] || payload;
  }

  const nextExpense = {
    id: `exp_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...expense,
  };

  expenses.push(nextExpense);
  return nextExpense;
}

async function getExpenses() {
  if (supabase) {
    const { data, error } = await supabase.from('expenses').select('*');
    if (error) {
      throw error;
    }

    return data.map((expense) => ({
      id: expense.id,
      paidBy: expense.paid_by,
      amount: Number(expense.amount),
      description: expense.description,
      category: expense.category,
      splitMode: expense.split_mode,
      numPeople: expense.num_people,
      isCleared: !!expense.is_cleared,
      createdAt: expense.created_at,
    }));
  }

  return [...expenses];
}

function getDbStatus() {
  return {
    mode: supabase ? 'supabase' : 'memory',
    developmentMode,
    configured: Boolean(supabase),
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasSupabaseKey: Boolean(supabaseKey),
  };
}

module.exports = {
  resetData,
  registerUser,
  findUserByLineId,
  getUsers,
  addExpense,
  getExpenses,
  getDbStatus,
  terminateUserByName,
  restoreUserByName,
  resetState,
};
