// Capa de datos sobre Supabase (PostgreSQL).
// El servidor usa la CLAVE SECRETA de Supabase, que se salta Row Level Security.
// Jamas la pongas en el navegador. El esquema esta en supabase/schema.sql.
const { createClient } = require('@supabase/supabase-js');

let client;
function sb() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  // SUPABASE_SECRET_KEY = clave "sb_secret_..."; SUPABASE_SERVICE_ROLE_KEY = clave antigua (service_role), tambien funciona
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY.');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return client;
}

// ---------- Conversion fila (snake_case, ISO) <-> usuario (camelCase, ms) ----------
const ms = (v) => (v ? new Date(v).getTime() : null);
const iso = (v) => (v == null ? null : new Date(v).toISOString());

function toUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    emailCanonical: r.email_canonical,
    passwordHash: r.password_hash,
    emailVerifiedAt: ms(r.email_verified_at),
    trialStartedAt: ms(r.trial_started_at),
    isPro: r.is_pro,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    profile: r.profile,
    photoInsight: r.photo_insight,
    photoCount: r.photo_count,
    photoWindowStart: ms(r.photo_window_start),
    tokenVersion: r.token_version,
    termsAcceptedAt: ms(r.terms_accepted_at),
    createdAt: ms(r.created_at),
  };
}

// campo del usuario -> [columna, conversion]
const FIELDS = {
  email: ['email'],
  emailCanonical: ['email_canonical'],
  passwordHash: ['password_hash'],
  emailVerifiedAt: ['email_verified_at', iso],
  trialStartedAt: ['trial_started_at', iso],
  isPro: ['is_pro'],
  stripeCustomerId: ['stripe_customer_id'],
  stripeSubscriptionId: ['stripe_subscription_id'],
  profile: ['profile'],
  photoInsight: ['photo_insight'],
  photoCount: ['photo_count'],
  photoWindowStart: ['photo_window_start', iso],
  tokenVersion: ['token_version'],
  termsAcceptedAt: ['terms_accepted_at', iso],
};

function toRow(patch) {
  const row = {};
  for (const [k, v] of Object.entries(patch)) {
    const f = FIELDS[k];
    if (!f) continue; // ignora campos desconocidos
    row[f[0]] = f[1] ? f[1](v) : v;
  }
  return row;
}

function must({ data, error }) {
  if (error) {
    const e = new Error(error.message || 'Error de base de datos');
    e.code = error.code;
    throw e;
  }
  return data;
}

// ---------- Usuarios ----------
async function findOne(column, value) {
  return toUser(must(await sb().from('users').select('*').eq(column, value).maybeSingle()));
}

module.exports = {
  findByCanonicalEmail: (canonical) => findOne('email_canonical', canonical),
  findById: (id) => findOne('id', id),
  findByStripeCustomer: (customerId) => findOne('stripe_customer_id', customerId),

  async create(user) {
    const { data, error } = await sb().from('users').insert(toRow(user)).select('*').single();
    if (error) {
      if (error.code === '23505') { const e = new Error('Correo ya registrado'); e.code = 'EMAIL_TAKEN'; throw e; }
      must({ data, error });
    }
    return toUser(data);
  },

  async update(id, patch) {
    const row = toRow(patch);
    if (!Object.keys(row).length) return module.exports.findById(id);
    return toUser(must(await sb().from('users').update(row).eq('id', id).select('*').maybeSingle()));
  },

  async remove(id) {
    must(await sb().from('users').delete().eq('id', id)); // los tokens se borran en cascada
  },

  // ---------- Tokens de correo (se guarda solo el hash) ----------
  async createToken({ userId, type, tokenHash, expiresAt }) {
    must(await sb().from('email_tokens').insert({ user_id: userId, type, token_hash: tokenHash, expires_at: iso(expiresAt) }));
  },

  // Consume el token de forma atomica: solo una peticion puede usarlo. Devuelve el id del usuario o null.
  async consumeToken(type, tokenHash) {
    const rows = must(await sb().from('email_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('type', type).eq('token_hash', tokenHash)
      .is('used_at', null).gt('expires_at', new Date().toISOString())
      .select('user_id'));
    return rows && rows.length ? rows[0].user_id : null;
  },

  // Deja sin efecto los enlaces anteriores sin usar (solo el ultimo enlace funciona)
  async invalidateTokens(userId, type) {
    must(await sb().from('email_tokens').update({ used_at: new Date().toISOString() })
      .eq('user_id', userId).eq('type', type).is('used_at', null));
  },

  async latestTokenAt(userId, type) {
    const rows = must(await sb().from('email_tokens').select('created_at')
      .eq('user_id', userId).eq('type', type).order('created_at', { ascending: false }).limit(1));
    return rows && rows.length ? ms(rows[0].created_at) : null;
  },

  // Para el health check: confirma que la base responde
  async ping() {
    must(await sb().from('users').select('id').limit(1));
    return true;
  },
};
