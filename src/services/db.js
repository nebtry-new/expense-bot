const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const users = [];
const expenses = [];

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

function normalizeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    lineUserId: user.line_user_id || user.lineUserId,
    displayName: user.display_name || user.displayName || 'ผู้ใช้',
    createdAt: user.created_at || user.createdAt,
  };
}

async function resetData() {
  if (supabase) {
    await supabase.from('expense_splits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  }

  users.length = 0;
  expenses.length = 0;
}

async function registerUser({ lineUserId, displayName }) {
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

    return data.map((user) => normalizeUser(user));
  }

  return [...users];
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
};
