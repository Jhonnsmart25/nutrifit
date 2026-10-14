'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailer } = require('../lib/mailer');

async function withFetch(impl, fn) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return impl(url, opts); };
  try { await fn(calls); } finally { global.fetch = real; }
}

test('Resend: manda clave, remitente, destinatario y enlace', async () => {
  await withFetch(async () => ({ ok: true, json: async () => ({ id: 'abc' }) }), async (calls) => {
    const m = createMailer({ resendKey: 're_123', emailFrom: 'NutriFit <no-reply@x.com>', isProd: true });
    await m.sendVerification('ana@b.com', 'https://app.test/verify-email?token=abc&x=1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer re_123');
    const body = JSON.parse(calls[0].opts.body);
    assert.deepEqual(body.to, ['ana@b.com']);
    assert.equal(body.from, 'NutriFit <no-reply@x.com>');
    assert.match(body.subject, /Confirma/);
    assert.ok(body.text.includes('https://app.test/verify-email?token=abc&x=1'), 'el texto lleva el enlace tal cual');
    assert.ok(body.html.includes('token=abc&amp;x=1'), 'el HTML escapa el enlace');
    assert.ok(!body.html.includes('abc&x=1'));
  });
});

test('los cuatro correos existen y llevan su enlace cuando corresponde', async () => {
  await withFetch(async () => ({ ok: true, json: async () => ({}) }), async (calls) => {
    const m = createMailer({ resendKey: 're_123', emailFrom: 'N <n@x.com>', isProd: true });
    await m.sendVerification('a@b.com', 'https://app.test/verify-email?token=1');
    await m.sendPasswordReset('a@b.com', 'https://app.test/reset-password?token=2');
    await m.sendAccountExists('a@b.com', 'https://app.test');
    await m.sendPasswordChanged('a@b.com');
    const bodies = calls.map((c) => JSON.parse(c.opts.body));
    assert.match(bodies[1].subject, /Restablece/);
    assert.ok(bodies[1].text.includes('reset-password?token=2'));
    assert.match(bodies[2].subject, /Ya tienes una cuenta/);
    assert.match(bodies[3].subject, /cambió/);
    assert.ok(!/href=/.test(bodies[3].html), 'el aviso de cambio no lleva enlace');
  });
});

test('escapa HTML en los textos', async () => {
  await withFetch(async () => ({ ok: true, json: async () => ({}) }), async (calls) => {
    const m = createMailer({ resendKey: 're_123', emailFrom: 'N <n@x.com>', isProd: true });
    await m.sendVerification('a@b.com', 'https://app.test/?q="><script>alert(1)</script>');
    const { html } = JSON.parse(calls[0].opts.body);
    assert.ok(!html.includes('<script>'));
  });
});

test('si Resend rechaza el envío, lanza error con el código', async () => {
  await withFetch(async () => ({ ok: false, status: 422, text: async () => 'dominio no verificado' }), async () => {
    const m = createMailer({ resendKey: 're_123', emailFrom: 'N <n@x.com>', isProd: true });
    await assert.rejects(m.sendPasswordReset('a@b.com', 'https://app.test/r'), /422/);
  });
});

test('sin clave y fuera de producción: simula el envío e imprime el enlace', async () => {
  const realLog = console.log;
  let printed = '';
  console.log = (...a) => { printed += a.join(' '); };
  try {
    const m = createMailer({ resendKey: null, emailFrom: 'N <n@x.com>', isProd: false });
    const r = await m.sendVerification('a@b.com', 'https://app.test/verify-email?token=zzz');
    assert.equal(r.simulated, true);
  } finally { console.log = realLog; }
  assert.match(printed, /token=zzz/);
});

test('sin clave en producción: falla en vez de callar', async () => {
  const m = createMailer({ resendKey: null, emailFrom: 'N <n@x.com>', isProd: true });
  await assert.rejects(m.sendVerification('a@b.com', 'https://app.test/v'), /RESEND_API_KEY/);
});
