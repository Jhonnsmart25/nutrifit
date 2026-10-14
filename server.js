require('dotenv').config();
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Stripe = require('stripe');

const { loadConfig } = require('./lib/config');

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  if (e.fatalConfig) { console.error(e.message); process.exit(1); }
  throw e;
}
cfg.warnings.forEach((w) => console.warn('[aviso]', w));

const db = require('./lib/db');
const { createMailer } = require('./lib/mailer');
const sec = require('./lib/security');
const { buildPlan, validateProfile } = require('./lib/plan');

const mailer = createMailer({ resendKey: cfg.resendKey, emailFrom: cfg.emailFrom, isProd: cfg.isProd });
const stripe = cfg.stripe ? new Stripe(cfg.stripe.secretKey) : null;

const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFY_TTL_MS = DAY_MS;            // enlace de verificación: 24 horas
const RESET_TTL_MS = 60 * 60 * 1000;     // enlace para restablecer: 1 hora
const EMAIL_COOLDOWN_MS = 60 * 1000;     // mínimo entre dos correos del mismo tipo a la misma cuenta
const BCRYPT_COST = 12;
// Hash falso para que el login tarde igual exista o no la cuenta (evita adivinar correos por tiempo de respuesta)
const DUMMY_HASH = bcrypt.hashSync('contraseña-falsa-para-igualar-tiempos', BCRYPT_COST);

const app = express();
app.disable('x-powered-by');
if (cfg.isProd) app.set('trust proxy', 1); // Render va detrás de un proxy: así req.ip es la IP real

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const background = (label, fn) => setImmediate(() => Promise.resolve().then(fn).catch((e) => console.error(`[${label}]`, e.message)));

// ---------- Salud (Render) ----------
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/readyz', wrap(async (req, res) => {
  try { await db.ping(); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
}));

// ---------- HTTPS y cabeceras de seguridad ----------
app.use((req, res, next) => {
  if (cfg.isProd && req.headers['x-forwarded-proto'] === 'http' && req.path !== '/healthz') {
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  if (cfg.isProd) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

// ---------- Stripe webhook (cuerpo crudo: va ANTES de express.json) ----------
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), wrap(async (req, res) => {
  if (!stripe) return res.status(503).send('Stripe no configurado');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], cfg.stripe.webhookSecret);
  } catch (err) {
    return res.status(400).send(`Firma inválida: ${err.message}`);
  }

  const obj = event.data.object;
  if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
    const user = obj.client_reference_id ? await db.findById(obj.client_reference_id) : await db.findByStripeCustomer(obj.customer);
    if (user) await db.update(user.id, { isPro: true, stripeCustomerId: obj.customer, stripeSubscriptionId: obj.subscription });
    else console.warn('[stripe] checkout completado sin usuario:', obj.id);
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const user = await db.findByStripeCustomer(obj.customer);
    if (user) {
      // past_due conserva el acceso mientras Stripe reintenta el cobro; si falla del todo, llega "deleted"/"unpaid"
      const active = ['active', 'trialing', 'past_due'].includes(obj.status) && event.type !== 'customer.subscription.deleted';
      await db.update(user.id, { isPro: active, stripeSubscriptionId: obj.id });
    }
  }
  res.json({ received: true }); // si algo falló arriba, responde 500 y Stripe reintenta
}));

app.use(express.json({ limit: '100kb' }));

// ---------- Límites de uso (en memoria; con una sola instancia en Render es suficiente) ----------
const hitsMap = new Map();
function tooMany(key, max, windowMs) {
  const now = Date.now();
  const arr = (hitsMap.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hitsMap.set(key, arr); return true; }
  arr.push(now);
  hitsMap.set(key, arr);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hitsMap) { if (!arr.some((t) => now - t < 60 * 60 * 1000)) hitsMap.delete(k); }
}, 10 * 60 * 1000).unref();

const ipLimit = (name, max, windowMs) => (req, res, next) =>
  tooMany(`${name}|${req.ip}`, max, windowMs) ? res.status(429).json({ error: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' }) : next();

// ---------- Utilidades de usuario ----------
function publicUser(u) {
  const trialEndsAt = u.trialStartedAt ? u.trialStartedAt + cfg.trialDays * DAY_MS : null;
  const msLeft = trialEndsAt ? trialEndsAt - Date.now() : 0;
  const inTrial = msLeft > 0;
  return {
    email: u.email,
    isPro: !!u.isPro,
    inTrial,
    trialEndsAt,
    daysLeft: inTrial ? Math.ceil(msLeft / DAY_MS) : 0,
    locked: !u.isPro && !inTrial,
    profile: u.profile || null,
    photoInsight: u.photoInsight || null,
    billingEnabled: !!stripe,
    photoAI: !!cfg.anthropic,
  };
}

const signToken = (user) => jwt.sign({ sub: user.id, tv: user.tokenVersion }, cfg.jwtSecret, { algorithm: 'HS256', expiresIn: '30d' });

const auth = wrap(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  let payload;
  try { payload = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'] }); }
  catch { return res.status(401).json({ error: 'Sesión inválida o expirada' }); }
  const user = await db.findById(payload.sub);
  // tokenVersion distinto = la contraseña cambió después de emitir este token
  if (!user || !user.emailVerifiedAt || user.tokenVersion !== payload.tv) return res.status(401).json({ error: 'Sesión inválida o expirada' });
  req.user = user;
  next();
});

// Bloquea funciones si se acabó la prueba y no es Pro
function requireAccess(req, res, next) {
  if (publicUser(req.user).locked) {
    return res.status(402).json({ error: 'Tu semana gratis terminó. Para seguir con tu plan, adquiere el plan Pro.', locked: true });
  }
  next();
}

// ---------- Correos: verificación y restablecer ----------
// Cada función respeta una pausa mínima por cuenta para que nadie pueda llenar de correos a otra persona.
async function issueVerification(user) {
  const last = await db.latestTokenAt(user.id, 'verify');
  if (last && Date.now() - last < EMAIL_COOLDOWN_MS) return;
  await db.invalidateTokens(user.id, 'verify');
  const { token, hash } = sec.newToken();
  await db.createToken({ userId: user.id, type: 'verify', tokenHash: hash, expiresAt: Date.now() + VERIFY_TTL_MS });
  await mailer.sendVerification(user.email, `${cfg.appUrl}/verify-email?token=${token}`);
}

async function issueReset(user) {
  const last = await db.latestTokenAt(user.id, 'reset');
  if (last && Date.now() - last < EMAIL_COOLDOWN_MS) return;
  await db.invalidateTokens(user.id, 'reset');
  const { token, hash } = sec.newToken();
  await db.createToken({ userId: user.id, type: 'reset', tokenHash: hash, expiresAt: Date.now() + RESET_TTL_MS });
  await mailer.sendPasswordReset(user.email, `${cfg.appUrl}/reset-password?token=${token}`);
}

async function issueAccountExistsNotice(user) {
  const last = await db.latestTokenAt(user.id, 'notice'); // el registro de 'notice' solo sirve para la pausa
  if (last && Date.now() - last < 60 * 60 * 1000) return;
  await db.createToken({ userId: user.id, type: 'notice', tokenHash: sec.newToken().hash, expiresAt: Date.now() });
  await mailer.sendAccountExists(user.email, cfg.appUrl);
}

const GENERIC_SENT = 'Si el correo es válido, te enviamos un mensaje. Revisa tu bandeja de entrada y la carpeta de spam.';

// ---------- Cuentas ----------
// Registro: la respuesta es igual exista o no el correo (no revela quién tiene cuenta).
app.post('/api/auth/register', ipLimit('register', 10, 60 * 60 * 1000), wrap(async (req, res) => {
  const email = sec.normalizeEmail(req.body.email);
  const password = req.body.password;
  if (!sec.isValidEmail(email)) return res.status(400).json({ error: 'Escribe un correo válido.' });
  const pwErr = sec.passwordError(password, email);
  if (pwErr) return res.status(400).json({ error: pwErr });
  if (req.body.acceptTerms !== true) return res.status(400).json({ error: 'Debes aceptar el aviso de privacidad y los términos para crear tu cuenta.' });

  const canonical = sec.canonicalEmail(email);
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST); // siempre se calcula: el tiempo no delata si el correo ya existe
  let existing = await db.findByCanonicalEmail(canonical);
  let created = null;

  if (!existing) {
    try {
      created = await db.create({ email, emailCanonical: canonical, passwordHash, termsAcceptedAt: Date.now(), isPro: false, tokenVersion: 0, photoCount: 0 });
    } catch (e) {
      if (e.code !== 'EMAIL_TAKEN') throw e;
      existing = await db.findByCanonicalEmail(canonical); // alguien se registró al mismo tiempo
    }
  }

  // Cuenta aún sin confirmar: la contraseña más reciente reemplaza a la anterior. Así, quien se registró primero
  // con el correo de otra persona no conserva acceso a la cuenta cuando la persona real la crea y la confirma.
  // (Una cuenta sin confirmar no tiene datos: el perfil y el plan exigen correo confirmado.)
  if (existing && !existing.emailVerifiedAt) {
    existing = await db.update(existing.id, { passwordHash, tokenVersion: existing.tokenVersion + 1, termsAcceptedAt: Date.now() });
  }

  res.json({ ok: true, message: 'Te enviamos un correo para confirmar tu cuenta. Tu semana gratis empieza cuando lo confirmes.' });

  const target = created || existing;
  if (!target) return;
  background('registro', async () => {
    if (!target.emailVerifiedAt) await issueVerification(target);       // cuenta nueva o aún sin confirmar
    else await issueAccountExistsNotice(target);                          // ya tenía cuenta confirmada
  });
}));

app.post('/api/auth/resend-verification', ipLimit('resend', 10, 60 * 60 * 1000), wrap(async (req, res) => {
  const email = sec.normalizeEmail(req.body.email);
  res.json({ ok: true, message: GENERIC_SENT });
  if (!sec.isValidEmail(email) || tooMany(`resend|${sec.canonicalEmail(email)}`, 5, 60 * 60 * 1000)) return;
  background('reenviar', async () => {
    const user = await db.findByCanonicalEmail(sec.canonicalEmail(email));
    if (user && !user.emailVerifiedAt) await issueVerification(user);
  });
}));

// El enlace del correo abre la app, y la app llama aquí (POST): así los antivirus que "abren" enlaces no gastan el token.
app.post('/api/auth/verify-email', ipLimit('verify', 30, 15 * 60 * 1000), wrap(async (req, res) => {
  const token = String(req.body.token || '');
  const userId = token ? await db.consumeToken('verify', sec.hashToken(token)) : null;
  let user = userId ? await db.findById(userId) : null;
  if (!user) return res.status(400).json({ error: 'El enlace venció o ya se usó. Inicia sesión para pedir uno nuevo.', code: 'TOKEN_INVALID' });

  if (!user.emailVerifiedAt) {
    const now = Date.now();
    user = await db.update(user.id, { emailVerifiedAt: now, trialStartedAt: user.trialStartedAt || now }); // la semana gratis empieza aquí
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

app.post('/api/auth/login', ipLimit('login', 30, 15 * 60 * 1000), wrap(async (req, res) => {
  const email = sec.normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!sec.isValidEmail(email)) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  const canonical = sec.canonicalEmail(email);
  if (tooMany(`login|${canonical}`, 10, 15 * 60 * 1000)) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos o restablece tu contraseña.' });

  const user = await db.findByCanonicalEmail(canonical);
  const ok = await bcrypt.compare(password.slice(0, 200), user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  if (!user.emailVerifiedAt) return res.status(403).json({ error: 'Primero confirma tu correo. Te enviamos un enlace cuando creaste tu cuenta.', code: 'EMAIL_NOT_VERIFIED', email: user.email });
  res.json({ token: signToken(user), user: publicUser(user) });
}));

app.post('/api/auth/forgot', ipLimit('forgot', 10, 60 * 60 * 1000), wrap(async (req, res) => {
  const email = sec.normalizeEmail(req.body.email);
  res.json({ ok: true, message: GENERIC_SENT }); // misma respuesta exista o no la cuenta
  if (!sec.isValidEmail(email) || tooMany(`forgot|${sec.canonicalEmail(email)}`, 3, 60 * 60 * 1000)) return;
  background('olvidé contraseña', async () => {
    const user = await db.findByCanonicalEmail(sec.canonicalEmail(email));
    if (!user) return;
    if (user.emailVerifiedAt) await issueReset(user);
    else await issueVerification(user); // si nunca confirmó el correo, primero debe confirmarlo
  });
}));

app.post('/api/auth/reset', ipLimit('reset', 20, 15 * 60 * 1000), wrap(async (req, res) => {
  const token = String(req.body.token || '');
  const password = req.body.password;
  const pwErr = sec.passwordError(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const userId = token ? await db.consumeToken('reset', sec.hashToken(token)) : null;
  let user = userId ? await db.findById(userId) : null;
  if (!user) return res.status(400).json({ error: 'El enlace venció o ya se usó. Pide uno nuevo desde "¿Olvidaste tu contraseña?".', code: 'TOKEN_INVALID' });

  const patch = { passwordHash: await bcrypt.hash(password, BCRYPT_COST), tokenVersion: user.tokenVersion + 1 }; // cierra las demás sesiones
  if (!user.emailVerifiedAt) { patch.emailVerifiedAt = Date.now(); patch.trialStartedAt = user.trialStartedAt || Date.now(); }
  user = await db.update(user.id, patch);
  await db.invalidateTokens(user.id, 'reset');
  background('aviso de cambio', () => mailer.sendPasswordChanged(user.email));
  res.json({ token: signToken(user), user: publicUser(user) });
}));

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

// ---------- Perfil y plan ----------
app.post('/api/profile', auth, requireAccess, wrap(async (req, res) => {
  const b = req.body || {};
  const profile = {
    heightCm: Number(b.heightCm),
    weightKg: Number(b.weightKg),
    age: Number(b.age),
    sex: b.sex,
    activity: b.activity,
    hasCondition: !!b.hasCondition,
  };
  const errors = validateProfile(profile);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  const user = await db.update(req.user.id, { profile });
  res.json({ user: publicUser(user), plan: buildPlan(profile) });
}));

app.get('/api/plan', auth, requireAccess, (req, res) => {
  if (!req.user.profile) return res.status(404).json({ error: 'Aún no tienes perfil.' });
  res.json({ plan: buildPlan(req.user.profile), photoInsight: req.user.photoInsight || null });
});

// ---------- Foto de cuerpo completo (opcional, NO se guarda) ----------
const upload = multer({
  storage: multer.memoryStorage(), // la imagen vive solo en memoria durante la petición
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    cb(['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ? null : new Error('Formato no permitido (usa JPG, PNG o WEBP).'), true);
  },
});

const PHOTO_PROMPT = `Eres un asistente de una app de nutrición. Observa esta foto de cuerpo completo y devuelve SOLO un JSON válido, sin texto extra, con esta forma:
{"complexion":"delgada|media|robusta","distribucion":"texto breve y neutral","recomendaciones":["máximo 3 consejos prácticos de ejercicio o alimentación"],"confianza":"baja|media"}
Reglas: no estimes porcentaje de grasa ni peso, no emitas diagnósticos, no hagas comentarios sobre la apariencia ni juicios estéticos, usa lenguaje respetuoso. Si la imagen no muestra una persona de cuerpo completo, responde {"error":"imagen no válida"}.`;

async function analyzePhoto(buffer, mime) {
  if (!cfg.anthropic) {
    return { simulated: true, complexion: 'media', distribucion: 'Análisis simulado (falta configurar ANTHROPIC_API_KEY).', recomendaciones: ['Combina fuerza 3 veces por semana con caminata diaria.'], confianza: 'baja' };
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropic.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: cfg.anthropic.model,
      max_tokens: 400,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } },
        { type: 'text', text: PHOTO_PROMPT },
      ] }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Servicio de análisis no disponible (${r.status})`);
  const data = await r.json();
  const text = (data.content || []).map((c) => c.text || '').join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No se pudo interpretar el análisis.');
  const parsed = JSON.parse(match[0]);
  if (parsed.error) throw new Error('La imagen no parece una foto de cuerpo completo.');
  return parsed;
}

app.post('/api/photo', auth, requireAccess, (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'La imagen pesa más de 5 MB.' : err.message });
    handlePhoto(req, res).catch(next);
  });
});

async function handlePhoto(req, res) {
  const u = req.user;
  if (req.body.consent !== 'true') return res.status(400).json({ error: 'Debes aceptar el aviso de privacidad para enviar una foto.' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
  if (!u.profile) return res.status(400).json({ error: 'Primero completa tu perfil.' });
  if (u.profile.age < 18) return res.status(403).json({ error: 'El análisis por foto es solo para mayores de edad.' });

  // Cuota diaria por persona: cada análisis con IA cuesta dinero
  const now = Date.now();
  let count = u.photoCount || 0;
  let windowStart = u.photoWindowStart;
  if (!windowStart || now - windowStart > DAY_MS) { count = 0; windowStart = now; }
  if (count >= cfg.photoDailyLimit) return res.status(429).json({ error: 'Llegaste al límite de análisis de hoy. Inténtalo mañana.' });
  await db.update(u.id, { photoCount: count + 1, photoWindowStart: windowStart });

  try {
    const insight = await analyzePhoto(req.file.buffer, req.file.mimetype);
    // Solo guardamos el resultado en texto, nunca la imagen.
    const clean = {
      complexion: String(insight.complexion || ''),
      distribucion: String(insight.distribucion || ''),
      recomendaciones: Array.isArray(insight.recomendaciones) ? insight.recomendaciones.slice(0, 3).map(String) : [],
      confianza: String(insight.confianza || 'baja'),
      simulated: !!insight.simulated,
      at: Date.now(),
    };
    await db.update(u.id, { photoInsight: clean });
    res.json({ photoInsight: clean });
  } catch (e) {
    console.error('[foto]', e.message);
    res.status(502).json({ error: 'No pudimos analizar la foto en este momento. Inténtalo de nuevo.' });
  } finally {
    req.file.buffer = null;
  }
}

// ---------- Privacidad: borrar cuenta y datos ----------
app.delete('/api/account', auth, wrap(async (req, res) => {
  if (stripe && req.user.stripeSubscriptionId) await stripe.subscriptions.cancel(req.user.stripeSubscriptionId).catch((e) => console.error('[stripe cancelar]', e.message));
  await db.remove(req.user.id);
  res.json({ ok: true });
}));

// ---------- Cobros con Stripe ----------
app.post('/api/billing/checkout', auth, wrap(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Los pagos aún no están configurados.' });
  let customerId = req.user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: req.user.email, metadata: { userId: req.user.id } });
    customerId = customer.id;
    await db.update(req.user.id, { stripeCustomerId: customerId });
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: req.user.id,
    line_items: [{ price: cfg.stripe.priceId, quantity: 1 }],
    success_url: `${cfg.appUrl}/?paid=1`,
    cancel_url: `${cfg.appUrl}/?canceled=1`,
    allow_promotion_codes: true,
  });
  res.json({ url: session.url });
}));

app.post('/api/billing/portal', auth, wrap(async (req, res) => {
  if (!stripe || !req.user.stripeCustomerId) return res.status(400).json({ error: 'No hay suscripción que administrar.' });
  const session = await stripe.billingPortal.sessions.create({ customer: req.user.stripeCustomerId, return_url: cfg.appUrl });
  res.json({ url: session.url });
}));

// ---------- Estáticos (PWA) ----------
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => {
    if (file.endsWith('sw.js') || file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));
// /verify-email y /reset-password son pantallas de la app (SPA)
app.get('*', (req, res) => {
  if (path.extname(req.path)) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Errores ----------
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud es demasiado grande.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Solicitud inválida.' });
  console.error(`[error] ${req.method} ${req.path}:`, err.message);
  res.status(500).json({ error: 'Algo salió mal en el servidor. Inténtalo de nuevo.' });
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e && e.message ? e.message : e));

const server = app.listen(cfg.port, () => console.log(`NutriFit corriendo en ${cfg.appUrl} (puerto ${cfg.port})`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
