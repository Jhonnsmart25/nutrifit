'use strict';
// Carga server.js con piezas simuladas (express, bcrypt, jwt, multer, stripe, dotenv y Supabase) para probar las
// rutas sin red y sin instalar nada. Lo simulado solo imita lo mínimo que usa el servidor: no sustituye una prueba
// con las librerías reales (paso 5 del README).
const Module = require('module');
const path = require('path');
const { createFakeSupabase } = require('./fake-supabase');

const BASE_ENV = {
  NODE_ENV: '',
  APP_URL: 'https://nutrifit.test',
  JWT_SECRET: 'j'.repeat(48),
  SUPABASE_URL: 'https://prueba.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_prueba',
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  RESEND_API_KEY: undefined,
  EMAIL_FROM: undefined,
  REQUIRE_EMAIL_VERIFICATION: undefined,
  STRIPE_SECRET_KEY: undefined,
  STRIPE_WEBHOOK_SECRET: undefined,
  STRIPE_PRICE_ID: undefined,
  ANTHROPIC_API_KEY: undefined,
  TRIAL_DAYS: undefined,
  PHOTO_DAILY_LIMIT: undefined,
};

function loadServer(envOverrides = {}) {
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...envOverrides })) {
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }

  const sb = createFakeSupabase();
  const stripeCalls = { checkout: [], customers: [], cancelled: [] };

  // --- express falso: solo guarda las rutas para poder llamarlas ---
  const routes = [];
  const add = (method) => (p, ...handlers) => { routes.push({ method, path: p, handlers }); };
  const app = { disable() {}, set() {}, use() {}, get: add('GET'), post: add('POST'), delete: add('DELETE'), listen: () => ({ close: (cb) => cb && cb() }) };
  const passthrough = () => (req, res, next) => next();
  const express = Object.assign(() => app, { json: passthrough, raw: passthrough, static: passthrough });

  // --- bcrypt y jwt falsos (rápidos y reversibles; los reales se prueban en tu computadora) ---
  const bcryptjs = { hashSync: (p) => 'h:' + p, hash: async (p) => 'h:' + p, compare: async (p, h) => h === 'h:' + p };
  const jsonwebtoken = {
    sign: (payload) => 'jwt.' + Buffer.from(JSON.stringify(payload)).toString('base64url'),
    verify: (token) => {
      if (!String(token).startsWith('jwt.')) throw new Error('jwt malformed');
      return JSON.parse(Buffer.from(token.slice(4), 'base64url').toString());
    },
  };
  const multer = Object.assign(() => ({ single: () => (req, res, cb) => cb() }), { memoryStorage: () => ({}) });

  class Stripe {
    constructor() {
      this.customers = { create: async (a) => { stripeCalls.customers.push(a); return { id: 'cus_' + stripeCalls.customers.length }; } };
      this.checkout = { sessions: { create: async (a) => { stripeCalls.checkout.push(a); return { url: 'https://checkout.stripe.test/' + stripeCalls.checkout.length }; } } };
      this.billingPortal = { sessions: { create: async () => ({ url: 'https://portal.stripe.test/1' }) } };
      this.subscriptions = { cancel: async (id) => { stripeCalls.cancelled.push(id); } };
      this.webhooks = {
        constructEvent: (raw, sig) => {
          if (sig !== 'firma-buena') throw new Error('firma inválida');
          return JSON.parse(raw.toString());
        },
      };
    }
  }

  const mods = { express, bcryptjs, jsonwebtoken, multer, stripe: Stripe, dotenv: { config() {} }, '@supabase/supabase-js': { createClient: () => sb.client } };
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (Object.prototype.hasOwnProperty.call(mods, request)) return mods[request];
    return origLoad.call(this, request, ...rest);
  };

  // Lo que el servidor imprime (por ejemplo, los "correos simulados" con sus enlaces)
  const logs = [];
  console.log = (...a) => { logs.push(a.join(' ')); };

  require(path.join(__dirname, '..', '..', 'server.js'));

  // --- Llamar a una ruta como si llegara una petición ---
  function mkRes() {
    const r = { statusCode: 200, body: undefined, done: false, headersSent: false, _resolve: null };
    const finish = () => { r.done = true; r.headersSent = true; if (r._resolve) r._resolve(); };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; finish(); return r; };
    r.send = (b) => { r.body = b; finish(); return r; };
    r.end = () => { finish(); return r; };
    r.sendFile = () => { finish(); return r; };
    r.redirect = () => { finish(); return r; };
    r.setHeader = () => {};
    return r;
  }

  let ipN = 0;
  async function call(method, urlPath, { body = {}, rawBody, token, headers = {} } = {}) {
    const route = routes.find((r) => r.method === method && r.path === urlPath);
    if (!route) throw new Error(`Ruta no registrada: ${method} ${urlPath}`);
    ipN += 1; // una IP distinta por llamada: así no se mezclan los límites de intentos entre pruebas
    const req = {
      method, path: urlPath, body: rawBody || body, file: undefined, ip: `10.0.${Math.floor(ipN / 250)}.${ipN % 250}`,
      headers: { ...headers, ...(token ? { authorization: 'Bearer ' + token } : {}) },
    };
    const res = mkRes();
    await new Promise((resolve, reject) => {
      res._resolve = resolve;
      let i = 0;
      const next = (err) => {
        if (err) return reject(err);
        const h = route.handlers[i++];
        if (!h) return resolve();
        try {
          const out = h(req, res, next);
          if (out && typeof out.catch === 'function') out.catch(reject);
        } catch (e) { reject(e); }
      };
      next();
    });
    return { status: res.statusCode, body: res.body };
  }

  // Busca en lo impreso el último enlace "…/<parte>?token=XXXX" y devuelve el token
  function tokenFromLogs(part) {
    for (let i = logs.length - 1; i >= 0; i--) {
      const m = logs[i].match(new RegExp(`${part}\\?token=([\\w-]+)`));
      if (m) return m[1];
    }
    return null;
  }

  const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms)); // deja terminar lo que el servidor hace "en segundo plano"

  return { call, wait, sb, logs, stripeCalls, tokenFromLogs, routes };
}

module.exports = { loadServer };
