'use strict';
// Mismo servidor con REQUIRE_EMAIL_VERIFICATION=true: hay que confirmar el correo y la prueba empieza al confirmar.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('./helpers/server-harness');

const srv = loadServer({ REQUIRE_EMAIL_VERIFICATION: 'true' });
const { call, wait, sb, logs } = srv;

const PW = 'clave-segura-1';
const register = (email, password = PW) => call('POST', '/api/auth/register', { body: { email, password, acceptTerms: true } });
const login = (email, password = PW) => call('POST', '/api/auth/login', { body: { email, password } });
const row = (email) => sb.tables.users.find((u) => u.email === email);

test('la configuración pública dice que se pide confirmar el correo', async () => {
  assert.equal((await call('GET', '/api/auth/config')).body.requireEmailVerification, true);
});

test('registro: no entra todavía, la prueba no ha empezado y llega el enlace', async () => {
  const r = await register('ana@x.com');
  assert.equal(r.status, 200);
  assert.equal(r.body.token, undefined);
  assert.match(r.body.message, /confirmar/);
  assert.equal(row('ana@x.com').email_verified_at, null);
  assert.equal(row('ana@x.com').trial_started_at, null);
  await wait();
  assert.ok(srv.tokenFromLogs('verify-email'), 'llegó el enlace de confirmación');

  const l = await login('ana@x.com');
  assert.equal(l.status, 403);
  assert.equal(l.body.code, 'EMAIL_NOT_VERIFIED');
});

test('confirmar el correo: entra a la cuenta y empieza la prueba de 7 días; el enlace sirve una sola vez', async () => {
  await register('beto@x.com');
  await wait();
  const t = srv.tokenFromLogs('verify-email');
  const v = await call('POST', '/api/auth/verify-email', { body: { token: t } });
  assert.equal(v.status, 200);
  assert.equal(v.body.user.inTrial, true);
  assert.equal(v.body.user.daysLeft, 7);
  assert.ok(row('beto@x.com').trial_started_at);
  assert.equal((await call('GET', '/api/me', { token: v.body.token })).status, 200);
  assert.equal((await login('beto@x.com')).status, 200);

  const again = await call('POST', '/api/auth/verify-email', { body: { token: t } });
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'TOKEN_INVALID');
});

test('quien se registró primero con el correo de otra persona no conserva acceso', async () => {
  await register('victima@x.com', 'clave-del-atacante-1');
  await register('victima@x.com', 'clave-de-la-victima-1');
  assert.equal((await login('victima@x.com', 'clave-del-atacante-1')).status, 401);
  const v = await login('victima@x.com', 'clave-de-la-victima-1');
  assert.equal(v.status, 403);
  assert.equal(v.body.code, 'EMAIL_NOT_VERIFIED');
});

test('registro: la respuesta es igual exista o no el correo, y avisa a quien ya tenía cuenta', async () => {
  const nuevo = await register('g1@x.com');
  await register('g2@x.com');
  await wait();
  await call('POST', '/api/auth/verify-email', { body: { token: srv.tokenFromLogs('verify-email') } });
  assert.ok(row('g2@x.com').email_verified_at);

  const repetido = await register('g2@x.com');
  assert.deepEqual(repetido.body, nuevo.body);
  await wait();
  assert.ok(logs.some((l) => /Ya tienes una cuenta/.test(l) && /g2@x\.com/.test(l)));
});

test('olvidé mi contraseña responde igual con un correo que no existe y no manda nada', async () => {
  const antes = logs.length;
  const r = await call('POST', '/api/auth/forgot', { body: { email: 'nadie@x.com' } });
  await wait();
  assert.equal(r.status, 200);
  assert.equal(logs.length, antes);
});

test('restablecer la contraseña cierra las sesiones anteriores', async () => {
  await register('fer@x.com');
  await wait();
  const { body: { token: old } } = await call('POST', '/api/auth/verify-email', { body: { token: srv.tokenFromLogs('verify-email') } });
  await call('POST', '/api/auth/forgot', { body: { email: 'fer@x.com' } });
  await wait();
  const r = await call('POST', '/api/auth/reset', { body: { token: srv.tokenFromLogs('reset-password'), password: 'nueva-clave-2' } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/me', { token: old })).status, 401);
  assert.equal((await login('fer@x.com', 'nueva-clave-2')).status, 200);
});
