const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const users = [];
const deletedUsers = [];
const expenses = [];
const trips = [];
const tripPlaces = [];
let carProfile = null;
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
  trips.length = 0;
  tripPlaces.length = 0;
  carProfile = null;
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

  const nameTaken = currentUsers.find(
    (u) => (u.displayName || '').toLowerCase() === (displayName || '').toLowerCase()
  );
  if (nameTaken) {
    throw Object.assign(new Error(`มีผู้ใช้ชื่อ "${displayName}" อยู่แล้ว กรุณาใช้ชื่ออื่น`), { code: 'DUPLICATE_NAME' });
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

async function renameUserByLineId(lineUserId, newDisplayName) {
  const trimmedName = String(newDisplayName || '').trim();
  if (!trimmedName) {
    return null;
  }

  const currentUser = await findUserByLineId(lineUserId);
  if (!currentUser) {
    return null;
  }

  const allUsers = await getUsers();
  const nameTaken = allUsers.find(
    (u) => String(u.id) !== String(currentUser.id) &&
    (u.displayName || '').toLowerCase() === trimmedName.toLowerCase()
  );
  if (nameTaken) {
    throw Object.assign(new Error(`มีผู้ใช้ชื่อ "${trimmedName}" อยู่แล้ว กรุณาใช้ชื่ออื่น`), { code: 'DUPLICATE_NAME' });
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .update({ display_name: trimmedName })
      .eq('id', currentUser.id)
      .select();

    if (error) {
      throw error;
    }

    return normalizeUser(data?.[0]) || null;
  }

  const userIndex = users.findIndex((entry) => entry.id === currentUser.id);
  if (userIndex < 0) {
    return null;
  }

  users[userIndex].displayName = trimmedName;
  return { ...users[userIndex] };
}

async function addExpense(expense) {
  if (supabase) {
    const payload = {
      paid_by: expense.paidByUserId,
      amount: expense.amount,
      description: expense.description,
      category: expense.category || 'other',
      split_mode: expense.splitMode || 'half',
      num_people: expense.numPeople || null,
      is_cleared: false,
      slip_url: expense.slipUrl || null,
      trip_id: expense.tripId || null,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('expenses').insert(payload).select();
    if (error) throw error;

    const saved = data?.[0] || payload;

    if (expense.customAmounts && saved.id) {
      const splitRows = Object.entries(expense.customAmounts).map(([userId, amount]) => ({
        expense_id: saved.id,
        user_id: userId,
        amount,
      }));
      const { error: splitError } = await supabase.from('expense_splits').insert(splitRows);
      if (splitError) throw splitError;
    }

    return saved;
  }

  const nextExpense = {
    id: `exp_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...expense,
    paidByUserId: expense.paidByUserId,
    paidByDisplayName: expense.paidByDisplayName,
  };

  expenses.push(nextExpense);
  return nextExpense;
}

async function getExpenses() {
  if (supabase) {
    const { data, error } = await supabase
      .from('expenses')
      .select('*, expense_splits(user_id, amount)')
      .order('created_at', { ascending: true });
    if (error) throw error;

    return data.map((expense) => {
      let customAmounts = null;
      if (expense.split_mode === 'custom' && expense.expense_splits?.length) {
        customAmounts = {};
        for (const split of expense.expense_splits) {
          customAmounts[String(split.user_id)] = Number(split.amount);
        }
      }
      return {
        id: expense.id,
        paidByUserId: expense.paid_by,
        amount: Number(expense.amount),
        description: expense.description,
        category: expense.category,
        splitMode: expense.split_mode,
        numPeople: expense.num_people,
        isCleared: !!expense.is_cleared,
        customAmounts,
        tripId: expense.trip_id || null,
        createdAt: expense.created_at,
      };
    });
  }

  return [...expenses];
}

async function clearSettlement() {
  if (supabase) {
    const { error } = await supabase
      .from('expenses')
      .update({ is_cleared: true })
      .eq('is_cleared', false);
    if (error) throw error;
    return;
  }

  for (const expense of expenses) {
    expense.isCleared = true;
  }
}

async function findLastExpense(paidByUserId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('expenses')
      .select('id, description, amount')
      .eq('paid_by', paidByUserId)
      .eq('is_cleared', false)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data?.length) return null;
    return { id: data[0].id, description: data[0].description, amount: Number(data[0].amount) };
  }
  const found = [...expenses].reverse().find(
    (e) => String(e.paidByUserId) === String(paidByUserId) && !e.isCleared
  );
  return found ? { id: found.id, description: found.description, amount: Number(found.amount) } : null;
}

async function deleteExpenseById(id) {
  if (supabase) {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  const idx = expenses.findIndex((e) => e.id === id);
  if (idx >= 0) expenses.splice(idx, 1);
}

async function deleteLastExpense(paidByUserId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('expenses')
      .select('id, description, amount')
      .eq('paid_by', paidByUserId)
      .eq('is_cleared', false)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!data?.length) return null;

    const target = data[0];
    const { error: delError } = await supabase.from('expenses').delete().eq('id', target.id);
    if (delError) throw delError;

    return { id: target.id, description: target.description, amount: Number(target.amount) };
  }

  const idx = [...expenses].reverse().findIndex(
    (e) => String(e.paidByUserId) === String(paidByUserId) && !e.isCleared
  );
  if (idx === -1) return null;

  const realIdx = expenses.length - 1 - idx;
  const [removed] = expenses.splice(realIdx, 1);
  return { id: removed.id, description: removed.description, amount: Number(removed.amount) };
}

async function createTrip(name, defaultSplitMode = 'half', defaultNumPeople = null) {
  const payload = { name, default_split_mode: defaultSplitMode, default_num_people: defaultNumPeople || null };
  if (supabase) {
    const { data, error } = await supabase.from('trips').insert(payload).select();
    if (error) throw error;
    return data?.[0] || null;
  }
  const trip = {
    id: `trip_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    name,
    default_split_mode: defaultSplitMode,
    default_num_people: defaultNumPeople || null,
    createdAt: new Date().toISOString(),
  };
  trips.push(trip);
  return trip;
}

async function getTrips() {
  if (supabase) {
    const { data, error } = await supabase.from('trips').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return [...trips];
}

async function findTripByName(name) {
  const allTrips = await getTrips();
  const lower = name.toLowerCase();
  return allTrips.find((t) => (t.name || '').toLowerCase() === lower) || null;
}

async function addTripPlace(tripId, name, notes = null, category = 'other', mapsUrl = null) {
  if (supabase) {
    const { data, error } = await supabase
      .from('trip_places')
      .insert({ trip_id: tripId, name, notes, category, maps_url: mapsUrl, status: 'pending' })
      .select();
    if (error) throw error;
    return data?.[0] || null;
  }
  const place = {
    id: `place_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    trip_id: tripId,
    name,
    notes,
    category: category || 'other',
    maps_url: mapsUrl,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  tripPlaces.push(place);
  return place;
}

async function markTripPlaceVisited(tripId, placeName) {
  const lower = placeName.toLowerCase();
  if (supabase) {
    const { data: places, error: findErr } = await supabase
      .from('trip_places')
      .select('id, name')
      .eq('trip_id', tripId);
    if (findErr) throw findErr;
    const match = places?.find((p) => p.name.toLowerCase().includes(lower));
    if (!match) return null;
    const { error } = await supabase.from('trip_places').update({ status: 'visited' }).eq('id', match.id);
    if (error) throw error;
    return match;
  }
  const place = tripPlaces.find((p) => p.trip_id === tripId && p.name.toLowerCase().includes(lower));
  if (!place) return null;
  place.status = 'visited';
  return place;
}

async function getTripPlaces(tripId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('trip_places')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  return tripPlaces.filter((p) => p.trip_id === tripId);
}

async function addTripNote(tripId, content) {
  if (supabase) {
    const { data, error } = await supabase
      .from('trip_notes')
      .insert({ trip_id: tripId, content })
      .select();
    if (error) throw error;
    return data?.[0] || null;
  }
  const note = {
    id: `note_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    trip_id: tripId,
    content,
    createdAt: new Date().toISOString(),
  };
  // store in-memory alongside tripPlaces
  if (!global._tripNotes) global._tripNotes = [];
  global._tripNotes.push(note);
  return note;
}

async function getTripNotes(tripId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('trip_notes')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  return (global._tripNotes || []).filter((n) => n.trip_id === tripId);
}

async function getCarProfile() {
  if (supabase) {
    const { data, error } = await supabase
      .from('car_profile')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data?.[0] || null;
  }
  return carProfile;
}

async function setCarProfile(maxRangeKm) {
  if (supabase) {
    const existing = await getCarProfile();
    if (existing) {
      const { data, error } = await supabase
        .from('car_profile')
        .update({ max_range_km: maxRangeKm, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select();
      if (error) throw error;
      return data?.[0] || null;
    }
    const { data, error } = await supabase
      .from('car_profile')
      .insert({ max_range_km: maxRangeKm })
      .select();
    if (error) throw error;
    return data?.[0] || null;
  }
  carProfile = { max_range_km: maxRangeKm };
  return carProfile;
}

async function getExpensesByTrip(tripId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('expenses')
      .select('*, expense_splits(user_id, amount)')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map((expense) => {
      let customAmounts = null;
      if (expense.split_mode === 'custom' && expense.expense_splits?.length) {
        customAmounts = {};
        for (const split of expense.expense_splits) {
          customAmounts[String(split.user_id)] = Number(split.amount);
        }
      }
      return {
        id: expense.id,
        paidByUserId: expense.paid_by,
        amount: Number(expense.amount),
        description: expense.description,
        splitMode: expense.split_mode,
        numPeople: expense.num_people,
        isCleared: !!expense.is_cleared,
        customAmounts,
        tripId: expense.trip_id,
        createdAt: expense.created_at,
      };
    });
  }
  return expenses.filter((e) => e.tripId === tripId);
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
  clearSettlement,
  findLastExpense,
  deleteExpenseById,
  createTrip,
  getTrips,
  findTripByName,
  getExpensesByTrip,
  addTripPlace,
  getTripPlaces,
  markTripPlaceVisited,
  addTripNote,
  getTripNotes,
  getCarProfile,
  setCarProfile,
  getDbStatus,
  terminateUserByName,
  restoreUserByName,
  renameUserByLineId,
  resetState,
};
