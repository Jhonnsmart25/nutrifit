'use strict';
// Producción real de tu primer lanzamiento: sin Resend, sin clave de Anthropic y sin Stripe.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('./helpers/server-harness');

const srv = loadServer({ NODE_ENV: 'production' });
const { call, wait, sb, logs } = srv;

const PW = 'clave-segura-1';
const register = (email) => call('POST', '/api/auth/register', { body: { email, password: PW, acceptTerms: true } });

test('arranca en producción sin Resend y la app sabe que no hay correos', async () => {
  const r = await call('GET', '/api/auth/config');
  assert.equal(r.body.requireEmailVerification, false);
  assert.equal(r.body.emailEnabled, false);
});

test('el registro funciona igual y no intenta mandar ningún correo', async () => {
  const r = await register('ana@x.com');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.daysLeft, 7);
  await wait();
  assert.equal(sb.tables.email_tokens.length, 0);
  assert.ok(!logs.some((l) => /Resend|correo simulado/.test(l)));
});

test('"olvidé mi contraseña" responde que no está disponible, sin prometer un correo', async () => {
  const r = await call('POST', '/api/auth/forgot', { body: { email: 'ana@x.com' } });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /no está disponible/);
  assert.equal(sb.tables.email_tokens.length, 0);
});

test('sin clave de Anthropic la foto no se ofrece ni se acepta', async () => {
  const { body: { token, user } } = await register('beto@x.com');
  assert.equal(user.photoEnabled, false);
  const r = await call('POST', '/api/photo', { token });
  assert.equal(r.status, 503);
});

test('sin Stripe, el botón de pago avisa que no está configurado', async () => {
  const { body: { token, user } } = await register('carla@x.com');
  assert.equal(user.billingEnabled, false);
  const r = await call('POST', '/api/billing/checkout', { token });
  assert.equal(r.status, 503);
});
