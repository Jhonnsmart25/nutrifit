'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// lib/db.js pide '@supabase/supabase-js': aquí se le entrega el cliente falso.
const fake = createFakeSupabase();
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@supabase/supabase-js') return { createClient: () => fake.client };
  return origLoad.call(this, request, ...rest);
};
process.env.SUPABASE_URL = 'https://prueba.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_prueba';
const db = require('../lib/db');

let n = 0;
const mk = (extra = {}) => {
  n += 1;
  return db.create({ email: `u${n}@x.com`, emailCanonical: `u${n}@x.com`, passwordHash: 'hash', termsAcceptedAt: Date.now(), isPro: false, tokenVersion: 0, photoCount: 0, ...extra });
};

test('crear y buscar usuario: convierte columnas a camelCase y fechas a milisegundos', async () => {
  const u = await mk();
  assert.equal(typeof u.id, 'string');
  assert.equal(u.tokenVersion, 0);
  assert.equal(u.isPro, false);
  assert.equal(typeof u.termsAcceptedAt, 'number');
  assert.equal(typeof u.createdAt, 'number');
  assert.equal(u.emailVerifiedAt, null);
  assert.equal(u.trialStartedAt, null);
  assert.equal((await db.findById(u.id)).email, u.email);
  assert.equal((await db.findByCanonicalEmail(u.emailCanonical)).id, u.id);
  assert.equal(await db.findById('00000000-0000-0000-0000-000000000000'), null);
});

test('un correo canónico repetido lanza EMAIL_TAKEN', async () => {
  const u = await mk();
  await assert.rejects(
    db.create({ email: 'otro@x.com', emailCanonical: u.emailCanonical, passwordHash: 'h' }),
    (e) => e.code === 'EMAIL_TAKEN');
});

test('update: guarda fechas, perfil y contador; ignora campos desconocidos', async () => {
  const u = await mk();
  const t = Date.now();
  const up = await db.update(u.id, {
    emailVerifiedAt: t, trialStartedAt: t, isPro: true, tokenVersion: 3,
    profile: { heightCm: 170, weightKg: 70 }, hacked: true, id: 'otro-id',
  });
  assert.equal(up.emailVerifiedAt, t);
  assert.equal(up.trialStartedAt, t);
  assert.equal(up.isPro, true);
  assert.equal(up.tokenVersion, 3);
  assert.deepEqual(up.profile, { heightCm: 170, weightKg: 70 });
  assert.equal(up.id, u.id);
  assert.ok(!('hacked' in fake.tables.users.find((r) => r.id === u.id)));
  assert.equal(await db.update('00000000-0000-0000-0000-000000000000', { isPro: true }), null);
});

test('buscar por cliente de Stripe', async () => {
  const u = await mk();
  await db.update(u.id, { stripeCustomerId: 'cus_123', stripeSubscriptionId: 'sub_1' });
  assert.equal((await db.findByStripeCustomer('cus_123')).id, u.id);
  assert.equal(await db.findByStripeCustomer('cus_nope'), null);
});

test('token: se puede usar una sola vez', async () => {
  const u = await mk();
  await db.createToken({ userId: u.id, type: 'verify', tokenHash: 'h-una-vez', expiresAt: Date.now() + 60000 });
  assert.equal(await db.consumeToken('verify', 'h-una-vez'), u.id);
  assert.equal(await db.consumeToken('verify', 'h-una-vez'), null);
});

test('token: vencido, de otro tipo o inexistente no sirve', async () => {
  const u = await mk();
  await db.createToken({ userId: u.id, type: 'verify', tokenHash: 'h-vencido', expiresAt: Date.now() - 1000 });
  await db.createToken({ userId: u.id, type: 'reset', tokenHash: 'h-reset', expiresAt: Date.now() + 60000 });
  assert.equal(await db.consumeToken('verify', 'h-vencido'), null);
  assert.equal(await db.consumeToken('verify', 'h-reset'), null, 'un token de reset no sirve para verificar');
  assert.equal(await db.consumeToken('reset', 'h-no-existe'), null);
  assert.equal(await db.consumeToken('reset', 'h-reset'), u.id);
});

test('invalidateTokens deja sin efecto los enlaces anteriores sin usar', async () => {
  const u = await mk();
  await db.createToken({ userId: u.id, type: 'reset', tokenHash: 'h-viejo', expiresAt: Date.now() + 60000 });
  await db.invalidateTokens(u.id, 'reset');
  assert.equal(await db.consumeToken('reset', 'h-viejo'), null);
});

test('latestTokenAt devuelve la fecha del último token o null', async () => {
  const u = await mk();
  assert.equal(await db.latestTokenAt(u.id, 'verify'), null);
  await db.createToken({ userId: u.id, type: 'verify', tokenHash: 'h-a', expiresAt: Date.now() + 60000 });
  const first = await db.latestTokenAt(u.id, 'verify');
  await db.createToken({ userId: u.id, type: 'verify', tokenHash: 'h-b', expiresAt: Date.now() + 60000 });
  const second = await db.latestTokenAt(u.id, 'verify');
  assert.equal(typeof first, 'number');
  assert.ok(second > first);
  assert.equal(await db.latestTokenAt(u.id, 'reset'), null);
});

test('borrar la cuenta borra también sus tokens', async () => {
  const u = await mk();
  await db.createToken({ userId: u.id, type: 'verify', tokenHash: 'h-cascada', expiresAt: Date.now() + 60000 });
  await db.remove(u.id);
  assert.equal(await db.findById(u.id), null);
  assert.ok(!fake.tables.email_tokens.some((t) => t.user_id === u.id));
});

test('ping responde', async () => {
  assert.equal(await db.ping(), true);
});
