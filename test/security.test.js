'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sec = require('../lib/security');

test('normalizeEmail recorta espacios y pasa a minúsculas', () => {
  assert.equal(sec.normalizeEmail('  Juan@Gmail.COM '), 'juan@gmail.com');
  assert.equal(sec.normalizeEmail(undefined), '');
  assert.equal(sec.normalizeEmail(null), '');
});

test('isValidEmail', () => {
  assert.equal(sec.isValidEmail('a@b.co'), true);
  for (const bad of ['', 'a', 'a@b', 'a b@c.com', '@b.com', 'a@.com '.trim() + ' x']) assert.equal(sec.isValidEmail(bad), false, bad);
  assert.equal(sec.isValidEmail('a'.repeat(250) + '@b.com'), false, 'demasiado largo');
});

test('canonicalEmail: Gmail ignora puntos y alias; googlemail es gmail', () => {
  const same = ['juan@gmail.com', 'j.u.a.n@gmail.com', 'juan+promo@gmail.com', 'j.uan+2@gmail.com', 'juan@googlemail.com'];
  for (const e of same) assert.equal(sec.canonicalEmail(e), 'juan@gmail.com', e);
});

test('canonicalEmail: otros dominios conservan los puntos pero pierden el alias', () => {
  assert.equal(sec.canonicalEmail('ana.perez+x@empresa.mx'), 'ana.perez@empresa.mx');
  assert.equal(sec.canonicalEmail('ana@empresa.mx'), 'ana@empresa.mx');
  assert.notEqual(sec.canonicalEmail('ana.perez@empresa.mx'), sec.canonicalEmail('anaperez@empresa.mx'));
});

test('canonicalEmail: un alias vacío no deja la parte local vacía', () => {
  assert.equal(sec.canonicalEmail('+algo@x.com'), '+algo@x.com');
});

test('passwordError', () => {
  assert.match(sec.passwordError('corta'), /al menos 8/);
  assert.match(sec.passwordError(undefined), /al menos 8/);
  assert.match(sec.passwordError(12345678), /al menos 8/);
  assert.match(sec.passwordError('a'.repeat(73)), /demasiado larga/);
  assert.match(sec.passwordError('ñ'.repeat(40)), /demasiado larga/, '40 letras ñ pesan 80 bytes');
  assert.match(sec.passwordError('juan@x.com', 'juan@x.com'), /igual a tu correo/);
  assert.equal(sec.passwordError('una-clave-larga-1'), null);
  assert.equal(sec.passwordError('a'.repeat(72)), null);
});

test('newToken: aleatorio, y en la base solo va el hash', () => {
  const a = sec.newToken();
  const b = sec.newToken();
  assert.notEqual(a.token, b.token);
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(sec.hashToken(a.token), a.hash);
  assert.notEqual(a.hash, a.token);
});
