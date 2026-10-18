'use strict';
// Flujo completo con la verificación de correo APAGADA (el modo por defecto):
// registro -> prueba de 7 días al instante -> bloqueo al día 7 -> pago con Stripe.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('./helpers/server-harness');

const srv = loadServer({ STRIPE_SECRET_KEY: 'sk_test_prueba123', STRIPE_WEBHOOK_SECRET: 'whsec_prueba123', STRIPE_PRICE_ID: 'price_prueba123' });
const { call, wait, sb, logs, stripeCalls } = srv;

const DAY = 24 * 60 * 60 * 1000;
const PW = 'clave-segura-1';
const profile = { heightCm: 170, weightKg: 85, age: 30, sex: 'male', activity: 'light' };

const register = (email, extra = {}) => call('POST', '/api/auth/register', { body: { email, password: PW, acceptTerms: true, ...extra } });
const login = (email, password = PW) => call('POST', '/api/auth/login', { body: { email, password } });
const row = (email) => sb.tables.users.find((u) => u.email === email);
const setTrialAge = (email, days) => { row(email).trial_started_at = new Date(Date.now() - days * DAY).toISOString(); };
const hook = (evt) => call('POST', '/api/stripe/webhook', { rawBody: Buffer.from(JSON.stringify(evt)), headers: { 'stripe-signature': 'firma-buena' } });
const pay = (email) => {
  const u = row(email);
  return hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_' + u.id, mode: 'subscription', client_reference_id: u.id, customer: u.stripe_customer_id || 'cus_' + u.id, subscription: 'sub_' + u.id } } });
};
const subEvent = (email, type, status) => {
  const u = row(email);
  return hook({ type, data: { object: { id: 'sub_' + u.id, customer: u.stripe_customer_id, status } } });
};

test('la configuración pública dice que no se pide confirmar el correo', async () => {
  const r = await call('GET', '/api/auth/config');
  assert.equal(r.body.requireEmailVerification, false);
  assert.equal(r.body.emailEnabled, true);
});

test('registro: la cuenta queda confirmada y la prueba de 7 días empieza al instante', async () => {
  const r = await register('ana@x.com');
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.token, 'string');
  assert.equal(r.body.user.email, 'ana@x.com');
  assert.equal(r.body.user.inTrial, true);
  assert.equal(r.body.user.daysLeft, 7);
  assert.equal(r.body.user.locked, false);
  assert.equal(r.body.user.isPro, false);
  const u = row('ana@x.com');
  assert.ok(u.email_verified_at, 'queda confirmada');
  assert.ok(Math.abs(Date.parse(u.trial_started_at) - Date.now()) < 5000, 'la prueba empieza ahora');
  assert.notEqual(u.password_hash, PW, 'la contraseña no se guarda en claro');
  await wait();
  assert.ok(!logs.some((l) => /correo simulado/.test(l)), 'no se manda ningún correo');
  assert.equal(sb.tables.email_tokens.length, 0, 'no se crea ningún enlace');
});

test('durante la prueba: la sesión del registro sirve para guardar el perfil y ver el plan', async () => {
  const { body: { token } } = await register('beto@x.com');
  assert.equal((await call('GET', '/api/me', { token })).status, 200);
  const p = await call('POST', '/api/profile', { token, body: profile });
  assert.equal(p.status, 200);
  assert.ok(p.body.plan.metrics.targetKcal > 0);
  assert.equal((await call('GET', '/api/plan', { token })).status, 200);
});

test('el mismo correo, o un alias de Gmail, no abre otra prueba', async () => {
  assert.equal((await register('luis@gmail.com')).status, 200);
  for (const e of ['luis@gmail.com', 'LUIS@gmail.com', 'l.uis@gmail.com', 'luis+otra@gmail.com', 'luis@googlemail.com']) {
    const r = await register(e);
    assert.equal(r.status, 409, e);
    assert.equal(r.body.code, 'EMAIL_TAKEN');
  }
  assert.equal(sb.tables.users.filter((u) => u.email_canonical === 'luis@gmail.com').length, 1);
});

test('registro: exige aceptar los términos, contraseña válida y correo válido', async () => {
  assert.equal((await register('v1@x.com', { acceptTerms: false })).status, 400);
  assert.equal((await register('v2@x.com', { password: 'corta' })).status, 400);
  assert.equal((await register('no-es-correo')).status, 400);
  assert.ok(!row('v1@x.com') && !row('v2@x.com'));
});

test('login: entra con la contraseña correcta y rechaza la incorrecta', async () => {
  await register('carla@x.com');
  const ok = await login('Carla@x.com');
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal((await login('carla@x.com', 'otra-clave-1')).status, 401);
  assert.equal((await login('nadie@x.com')).status, 401);
});

test('al llegar al día 7 la app se bloquea: plan y perfil responden 402 y el usuario queda locked', async () => {
  const { body: { token } } = await register('dani@x.com');
  await call('POST', '/api/profile', { token, body: profile });

  setTrialAge('dani@x.com', 6.5);
  assert.equal((await call('GET', '/api/plan', { token })).status, 200, 'el día 6 sigue abierta');
  assert.equal((await call('GET', '/api/me', { token })).body.user.daysLeft, 1);

  setTrialAge('dani@x.com', 8);
  const plan = await call('GET', '/api/plan', { token });
  assert.equal(plan.status, 402);
  assert.equal(plan.body.locked, true);
  assert.equal((await call('POST', '/api/profile', { token, body: profile })).status, 402);
  const me = await call('GET', '/api/me', { token });
  assert.equal(me.status, 200, 'puede ver su estado para mostrar el paywall');
  assert.equal(me.body.user.locked, true);
  assert.equal(me.body.user.inTrial, false);
  assert.equal((await login('dani@x.com')).body.user.locked, true, 'al volver a entrar sigue bloqueada');
});

test('bloqueado puede pagar con Stripe y el webhook reabre la app', async () => {
  const { body: { token } } = await register('eli@x.com');
  await call('POST', '/api/profile', { token, body: profile });
  setTrialAge('eli@x.com', 8);
  assert.equal((await call('GET', '/api/plan', { token })).status, 402);

  const co = await call('POST', '/api/billing/checkout', { token });
  assert.equal(co.status, 200);
  assert.match(co.body.url, /^https:\/\/checkout\.stripe\.test\//);
  const sent = stripeCalls.checkout.at(-1);
  assert.equal(sent.mode, 'subscription');
  assert.equal(sent.line_items[0].price, 'price_prueba123');
  assert.equal(sent.client_reference_id, row('eli@x.com').id);
  assert.equal(sent.customer, row('eli@x.com').stripe_customer_id);

  const evt = { type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', client_reference_id: row('eli@x.com').id, customer: row('eli@x.com').stripe_customer_id, subscription: 'sub_eli' } } };
  const bad = await call('POST', '/api/stripe/webhook', { rawBody: Buffer.from(JSON.stringify(evt)), headers: { 'stripe-signature': 'mala' } });
  assert.equal(bad.status, 400);
  assert.equal(row('eli@x.com').is_pro, false, 'una firma falsa no activa nada');
  assert.equal((await call('GET', '/api/plan', { token })).status, 402);

  assert.equal((await hook(evt)).status, 200);
  assert.equal(row('eli@x.com').is_pro, true);
  assert.equal((await call('GET', '/api/plan', { token })).status, 200);
  const me = await call('GET', '/api/me', { token });
  assert.equal(me.body.user.isPro, true);
  assert.equal(me.body.user.locked, false);
});

test('suscripción: past_due conserva el acceso; impaga o cancelada vuelve a bloquear', async () => {
  const { body: { token } } = await register('gus@x.com');
  setTrialAge('gus@x.com', 8);
  await pay('gus@x.com');
  assert.equal(row('gus@x.com').is_pro, true);

  await subEvent('gus@x.com', 'customer.subscription.updated', 'past_due');
  assert.equal(row('gus@x.com').is_pro, true);
  assert.equal((await call('GET', '/api/me', { token })).body.user.locked, false);

  await subEvent('gus@x.com', 'customer.subscription.updated', 'unpaid');
  assert.equal(row('gus@x.com').is_pro, false);
  assert.equal((await call('GET', '/api/me', { token })).body.user.locked, true);

  await pay('gus@x.com');
  assert.equal(row('gus@x.com').is_pro, true);
  await subEvent('gus@x.com', 'customer.subscription.deleted', 'canceled');
  assert.equal(row('gus@x.com').is_pro, false);
  assert.equal((await call('GET', '/api/me', { token })).body.user.locked, true);
});

test('cuenta creada cuando aún se pedía confirmar el correo: al entrar queda confirmada y empieza la prueba', async () => {
  await sb.client.from('users').insert({ email: 'viejo@x.com', email_canonical: 'viejo@x.com', password_hash: 'h:' + PW });
  assert.equal(row('viejo@x.com').email_verified_at, null);
  const r = await login('viejo@x.com');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.inTrial, true);
  assert.equal(r.body.user.daysLeft, 7);
  assert.ok(row('viejo@x.com').email_verified_at);
  assert.equal((await call('GET', '/api/me', { token: r.body.token })).status, 200);
});

test('olvidé mi contraseña: manda el enlace, cambia la clave y cierra la sesión anterior', async () => {
  const { body: { token: old } } = await register('fer@x.com');
  assert.equal((await call('POST', '/api/auth/forgot', { body: { email: 'fer@x.com' } })).status, 200);
  await wait();
  const t = srv.tokenFromLogs('reset-password');
  assert.ok(t, 'llegó un enlace de restablecer');

  const r = await call('POST', '/api/auth/reset', { body: { token: t, password: 'nueva-clave-2' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.inTrial, true, 'la prueba no se reinicia ni se pierde');
  assert.equal((await call('GET', '/api/me', { token: old })).status, 401, 'la sesión anterior se cerró');
  assert.equal((await call('GET', '/api/me', { token: r.body.token })).status, 200);
  assert.equal((await login('fer@x.com', PW)).status, 401);
  assert.equal((await login('fer@x.com', 'nueva-clave-2')).status, 200);

  const again = await call('POST', '/api/auth/reset', { body: { token: t, password: 'otra-clave-3' } });
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'TOKEN_INVALID');
});

test('borrar la cuenta cancela la suscripción y elimina los datos', async () => {
  const { body: { token } } = await register('hana@x.com');
  await pay('hana@x.com');
  const id = row('hana@x.com').id;
  const r = await call('DELETE', '/api/account', { token });
  assert.equal(r.status, 200);
  assert.ok(stripeCalls.cancelled.includes('sub_' + id));
  assert.equal(row('hana@x.com'), undefined);
  assert.equal((await login('hana@x.com')).status, 401);
});
