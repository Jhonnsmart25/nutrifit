'use strict';
// Cliente falso de Supabase, en memoria. Imita solo lo que usa lib/db.js
// (insert, select, update, delete, eq, is, gt, order, limit, single, maybeSingle),
// con las reglas del esquema: valores por defecto, columnas únicas y borrado en cascada.
const crypto = require('crypto');

let tick = 0;
const now = () => new Date(Date.now() + tick++).toISOString(); // siempre creciente

const DEFAULTS = {
  users: () => ({
    id: crypto.randomUUID(), email_verified_at: null, trial_started_at: null, is_pro: false,
    stripe_customer_id: null, stripe_subscription_id: null, profile: null, photo_insight: null,
    photo_count: 0, photo_window_start: null, token_version: 0, terms_accepted_at: null,
    created_at: now(), updated_at: now(),
  }),
  email_tokens: () => ({ id: crypto.randomUUID(), used_at: null, created_at: now() }),
};
const UNIQUE = { users: ['email_canonical', 'stripe_customer_id'], email_tokens: ['token_hash'] };

function createFakeSupabase() {
  const tables = { users: [], email_tokens: [] };
  const clone = (x) => structuredClone(x);

  function from(name) {
    const t = { op: 'select', payload: null, filters: [], sort: null, max: null, rows: false, one: null };
    const q = {
      select() { t.rows = true; return q; },
      insert(p) { t.op = 'insert'; t.payload = p; return q; },
      update(p) { t.op = 'update'; t.payload = p; return q; },
      delete() { t.op = 'delete'; return q; },
      eq(c, v) { t.filters.push((r) => (r[c] ?? null) === v); return q; },
      is(c, v) { t.filters.push((r) => (r[c] ?? null) === v); return q; },
      gt(c, v) { t.filters.push((r) => r[c] != null && r[c] > v); return q; },
      order(c, o = {}) { t.sort = [c, o.ascending !== false]; return q; },
      limit(n) { t.max = n; return q; },
      maybeSingle() { t.one = 'maybe'; return q; },
      single() { t.one = 'one'; return q; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };

    function finish(rows) {
      if (!t.rows) return { data: null, error: null };
      if (t.one) {
        if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'Se esperaba una fila y hay varias' } };
        if (!rows.length) return t.one === 'maybe' ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'Sin filas' } };
        return { data: clone(rows[0]), error: null };
      }
      return { data: clone(rows), error: null };
    }

    function run() {
      const table = tables[name];
      if (t.op === 'insert') {
        const row = { ...DEFAULTS[name](), ...t.payload };
        for (const col of UNIQUE[name]) {
          if (row[col] != null && table.some((r) => r[col] === row[col])) {
            return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint (${col})` } };
          }
        }
        if (name === 'email_tokens' && !tables.users.some((u) => u.id === row.user_id)) {
          return { data: null, error: { code: '23503', message: 'foreign key violation' } };
        }
        table.push(row);
        return finish([row]);
      }

      let rows = table.filter((r) => t.filters.every((f) => f(r)));
      if (t.op === 'update') {
        rows.forEach((r) => Object.assign(r, t.payload, name === 'users' ? { updated_at: now() } : {}));
        return finish(rows);
      }
      if (t.op === 'delete') {
        tables[name] = table.filter((r) => !rows.includes(r));
        if (name === 'users') tables.email_tokens = tables.email_tokens.filter((tk) => !rows.some((u) => u.id === tk.user_id));
        return finish([]);
      }
      if (t.sort) {
        const [col, asc] = t.sort;
        rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (t.max != null) rows = rows.slice(0, t.max);
      return finish(rows);
    }
    return q;
  }

  return { client: { from }, tables };
}

module.exports = { createFakeSupabase };
