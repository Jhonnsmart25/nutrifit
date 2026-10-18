'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../lib/config');

const JWT = 'a'.repeat(48);
const prodEnv = (extra = {}) => ({
  NODE_ENV: 'production',
  APP_URL: 'https://nutrifit.onrender.com',
  JWT_SECRET: JWT,
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_real',
  RESEND_API_KEY: 're_real',
  EMAIL_FROM: 'NutriFit <no-reply@nutrifit.mx>',
  ...extra,
});

function fatal(env) {
  try { loadConfig(env); } catch (e) { assert.equal(e.fatalConfig, true); return e.message; }
  assert.fail('debía lanzar error de configuración');
}

test('producción completa arranca', () => {
  const c = loadConfig(prodEnv());
  assert.equal(c.isProd, true);
  assert.equal(c.requireEmailVerification, false);
  assert.equal(c.jwtSecret, JWT);
  assert.equal(c.trialDays, 7);
  assert.equal(c.photoDailyLimit, 5);
  assert.equal(c.stripe, null);
  assert.equal(c.anthropic, null);
  assert.ok(c.warnings.some((w) => /Stripe/.test(w)));
});

test('producción: lista todas las variables que faltan', () => {
  const msg = fatal({ NODE_ENV: 'production', APP_URL: 'https://x.com', REQUIRE_EMAIL_VERIFICATION: 'true' });
  for (const v of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'JWT_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM']) assert.match(msg, new RegExp(v));
});

test('producción: APP_URL debe ser https', () => {
  assert.match(fatal(prodEnv({ APP_URL: 'http://nutrifit.mx' })), /APP_URL.*https/);
});

test('producción: JWT_SECRET corto o de ejemplo no se acepta', () => {
  assert.match(fatal(prodEnv({ JWT_SECRET: 'corto' })), /JWT_SECRET/);
  assert.match(fatal(prodEnv({ JWT_SECRET: 'cambia-esto-por-un-secreto-largo-y-aleatorio' })), /JWT_SECRET/);
});

test('los valores de ejemplo del .env.example cuentan como vacíos', () => {
  assert.match(fatal(prodEnv({ SUPABASE_URL: 'https://xxxxxxxxxxxx.supabase.co' })), /SUPABASE_URL/);
  assert.match(fatal(prodEnv({ REQUIRE_EMAIL_VERIFICATION: 'true', RESEND_API_KEY: 're_xxx' })), /RESEND_API_KEY/);
});

test('acepta la clave antigua service_role de Supabase', () => {
  const env = prodEnv({ SUPABASE_SERVICE_ROLE_KEY: 'eyJ.service.role' });
  delete env.SUPABASE_SECRET_KEY;
  assert.doesNotThrow(() => loadConfig(env));
});

test('Stripe: con clave exige webhook y precio', () => {
  const msg = fatal(prodEnv({ STRIPE_SECRET_KEY: 'sk_live_real' }));
  assert.match(msg, /STRIPE_WEBHOOK_SECRET/);
  assert.match(msg, /STRIPE_PRICE_ID/);
  const ok = loadConfig(prodEnv({ STRIPE_SECRET_KEY: 'sk_live_real', STRIPE_WEBHOOK_SECRET: 'whsec_real', STRIPE_PRICE_ID: 'price_real' }));
  assert.equal(ok.stripe.priceId, 'price_real');
});

test('Stripe: clave de prueba en producción avisa', () => {
  const c = loadConfig(prodEnv({ STRIPE_SECRET_KEY: 'sk_test_real', STRIPE_WEBHOOK_SECRET: 'whsec_real', STRIPE_PRICE_ID: 'price_real' }));
  assert.ok(c.warnings.some((w) => /PRUEBA/.test(w)));
});

test('desarrollo: sin nada más que Supabase, genera un JWT temporal y avisa', () => {
  const c = loadConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_real' });
  assert.equal(c.isProd, false);
  assert.equal(c.jwtSecret.length, 64);
  assert.ok(c.warnings.some((w) => /JWT_SECRET/.test(w)));
  assert.ok(c.warnings.some((w) => /RESEND_API_KEY/.test(w)));
  assert.equal(c.appUrl, 'http://localhost:3000');
});

test('desarrollo: sin Supabase tampoco arranca', () => {
  assert.match(fatal({}), /SUPABASE_URL/);
});

test('APP_URL pierde la diagonal final; días de prueba y límite de fotos se leen del entorno', () => {
  const c = loadConfig(prodEnv({ APP_URL: 'https://nutrifit.mx/', TRIAL_DAYS: '14', PHOTO_DAILY_LIMIT: '2' }));
  assert.equal(c.appUrl, 'https://nutrifit.mx');
  assert.equal(c.trialDays, 14);
  assert.equal(c.photoDailyLimit, 2);
});

test('la verificación de correo está apagada por defecto y se enciende con REQUIRE_EMAIL_VERIFICATION=true', () => {
  assert.equal(loadConfig(prodEnv()).requireEmailVerification, false);
  assert.equal(loadConfig(prodEnv({ REQUIRE_EMAIL_VERIFICATION: 'false' })).requireEmailVerification, false);
  assert.equal(loadConfig(prodEnv({ REQUIRE_EMAIL_VERIFICATION: 'true' })).requireEmailVerification, true);
  assert.equal(loadConfig(prodEnv({ REQUIRE_EMAIL_VERIFICATION: ' TRUE ' })).requireEmailVerification, true);
});

test('sin verificación de correo, producción arranca sin Resend y avisa qué se pierde', () => {
  const env = prodEnv();
  delete env.RESEND_API_KEY;
  delete env.EMAIL_FROM;
  const c = loadConfig(env);
  assert.equal(c.emailEnabled, false);
  assert.ok(c.warnings.some((w) => /Olvidaste tu contraseña/.test(w)));
});

test('con verificación de correo, producción exige Resend y EMAIL_FROM', () => {
  const env = prodEnv({ REQUIRE_EMAIL_VERIFICATION: 'true' });
  delete env.RESEND_API_KEY;
  delete env.EMAIL_FROM;
  const msg = fatal(env);
  assert.match(msg, /RESEND_API_KEY/);
  assert.match(msg, /EMAIL_FROM/);
});

test('con Resend pero sin EMAIL_FROM propio avisa del dominio', () => {
  const env = prodEnv();
  delete env.EMAIL_FROM;
  const c = loadConfig(env);
  assert.equal(c.emailEnabled, true);
  assert.ok(c.warnings.some((w) => /dominio/.test(w)));
});

test('fuera de producción los correos cuentan como disponibles (se imprimen en consola)', () => {
  const c = loadConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_real' });
  assert.equal(c.emailEnabled, true);
});

test('ANTHROPIC_API_KEY activa el análisis de foto con el modelo por defecto', () => {
  const c = loadConfig(prodEnv({ ANTHROPIC_API_KEY: 'sk-ant-real' }));
  assert.equal(c.anthropic.key, 'sk-ant-real');
  assert.equal(c.anthropic.model, 'claude-sonnet-5-5');
});
