'use strict';

/* ---------- Utilidades ---------- */
const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // solo con contenido estatico propio
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg, ms = 3200) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), ms);
}

const store = {
  get() { try { return localStorage.getItem('nf_token'); } catch { return null; } },
  set(t) { try { localStorage.setItem('nf_token', t); localStorage.setItem('nf_seen', '1'); } catch {} },
  clear() { try { localStorage.removeItem('nf_token'); } catch {} },
  seen() { try { return !!localStorage.getItem('nf_seen'); } catch { return false; } }, // ya entró antes: muestra "entrar" en vez de "crear cuenta"
};

const state = {
  token: store.get(), user: null, plan: null, photoInsight: null, tab: 'plan', day: null, deferredInstall: null,
  auth: { view: 'register', email: '', message: '', kind: '', resetToken: null },
};

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  // Las llamadas de cuenta (/auth/...) no llevan sesión: un login fallido no debe cerrar ni reiniciar la pantalla
  const isAuthCall = path.startsWith('/auth/');
  if (state.token && !isAuthCall) headers.Authorization = 'Bearer ' + state.token;
  let body = opts.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, { method: opts.method || 'GET', headers, body });
  } catch {
    throw new Error('Sin conexión. Revisa tu internet e inténtalo de nuevo.');
  }
  const data = await res.json().catch(() => ({}));
  const fail = (fallback) => Object.assign(new Error(data.error || fallback), { code: data.code, data, status: res.status });
  if (res.status === 401 && state.token && !isAuthCall) { logout(true); throw fail('Tu sesión venció. Entra de nuevo.'); }
  if (res.status === 402) { if (state.user) state.user.locked = true; render(); throw fail('Tu semana gratis terminó.'); }
  if (!res.ok) throw fail('Algo salió mal. Inténtalo otra vez.');
  return data;
}

function logout(silent) {
  store.clear();
  Object.assign(state, { token: null, user: null, plan: null, photoInsight: null, tab: 'plan', day: null, editing: false });
  state.auth = { view: 'login', email: '', message: '', kind: '', resetToken: null };
  if (!silent) toast('Sesión cerrada');
  render();
}

/* ---------- Render principal ---------- */
function render() {
  $app.replaceChildren();
  window.scrollTo(0, 0);
  if (!state.token || !state.user) return $app.append(AuthRouter());
  if (state.user.locked) return $app.append(Paywall());
  if (!state.user.profile || state.editing) return $app.append(Onboarding());
  return renderApp();
}

/* ---------- Autenticación ---------- */
const TERMS_URL = '/terminos.html';
const PRIVACY_URL = '/privacidad.html';

function setAuth(view, extra) {
  state.auth = { ...state.auth, view, ...(extra || {}) };
  render();
}

function AuthRouter() {
  switch (state.auth.view) {
    case 'login': return LoginScreen();
    case 'forgot': return ForgotScreen();
    case 'check': return CheckEmailScreen();
    case 'reset': return ResetScreen();
    case 'working': return WorkingScreen();
    default: return RegisterScreen();
  }
}

const authShell = (...children) => h('main', { class: 'screen' }, h('div', { class: 'brand' }, h('i'), 'NutriFit'), ...children);
const errorBox = () => h('div', { class: 'error', hidden: true, role: 'alert' });
const showError = (box, msg) => { box.textContent = msg; box.hidden = false; };

const emailField = (value) => h('div', { class: 'field' },
  h('label', { for: 'email' }, 'Correo'),
  h('input', { class: 'input', id: 'email', name: 'email', type: 'email', autocomplete: 'email', inputmode: 'email', required: true, value: value || '' }));

const passwordField = ({ label = 'Contraseña', name = 'password', autocomplete, hint }) => h('div', { class: 'field' },
  h('label', { for: name }, label),
  h('input', { class: 'input', id: name, name, type: 'password', autocomplete, minlength: 8, maxlength: 72, required: true }),
  hint ? h('span', { class: 'hint' }, hint) : null);

// Desactiva un botón unos segundos mostrando la cuenta regresiva
function cooldown(btn, label, seconds) {
  let left = seconds;
  btn.disabled = true;
  const tick = () => {
    if (!btn.isConnected) return;
    if (left <= 0) { btn.disabled = false; btn.textContent = label; return; }
    btn.textContent = `${label} (${left} s)`;
    left -= 1;
    setTimeout(tick, 1000);
  };
  tick();
}

function RegisterScreen() {
  const err = errorBox();
  const btn = h('button', { class: 'btn guava', type: 'submit' }, 'Crear mi cuenta');
  const terms = h('input', { type: 'checkbox', id: 'terms', name: 'terms' });

  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!terms.checked) return showError(err, 'Acepta el aviso de privacidad y los términos para continuar.');
    btn.disabled = true;
    try {
      const email = form.email.value.trim().toLowerCase();
      const d = await api('/auth/register', { method: 'POST', body: { email, password: form.password.value, acceptTerms: true } });
      setAuth('check', { kind: 'verify', email, message: d.message });
    } catch (ex) { showError(err, ex.message); btn.disabled = false; }
  } },
    err,
    emailField(),
    passwordField({ autocomplete: 'new-password', hint: 'Mínimo 8 caracteres.' }),
    h('label', { class: 'check', for: 'terms' }, terms,
      h('span', {}, 'Acepto el ', h('a', { href: PRIVACY_URL, target: '_blank', rel: 'noopener' }, 'aviso de privacidad'),
        ' y los ', h('a', { href: TERMS_URL, target: '_blank', rel: 'noopener' }, 'términos'),
        '. Entiendo que usarán mis datos de salud para armar mi plan.')),
    btn,
  );

  return authShell(
    h('div', { class: 'hero' },
      h('h1', {}, 'Come y muévete según tu cuerpo.'),
      h('p', {}, 'Dinos tu estatura, peso y estilo de vida. Te armamos comidas, bebidas y rutinas para la semana. Pruébalo 7 días gratis; la semana empieza cuando confirmes tu correo.')),
    installBanner(),
    form,
    h('button', { class: 'linkbtn', type: 'button', onclick: () => setAuth('login') }, 'Ya tengo cuenta'),
  );
}

function LoginScreen() {
  const err = errorBox();
  const btn = h('button', { class: 'btn guava', type: 'submit' }, 'Entrar');

  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true; btn.disabled = true;
    const email = form.email.value.trim().toLowerCase();
    try {
      const d = await api('/auth/login', { method: 'POST', body: { email, password: form.password.value } });
      state.token = d.token; store.set(d.token); state.user = d.user;
      await afterAuth();
    } catch (ex) {
      if (ex.code === 'EMAIL_NOT_VERIFIED') return setAuth('check', { kind: 'verify', email: (ex.data && ex.data.email) || email, message: ex.message });
      showError(err, ex.message); btn.disabled = false;
    }
  } },
    err,
    emailField(state.auth.email),
    passwordField({ autocomplete: 'current-password' }),
    btn,
  );

  return authShell(
    h('div', { class: 'hero' }, h('h1', {}, 'Qué bueno verte de nuevo.'), h('p', {}, 'Entra para ver el plan de hoy.')),
    form,
    h('button', { class: 'linkbtn', type: 'button', onclick: () => setAuth('forgot') }, '¿Olvidaste tu contraseña?'),
    h('button', { class: 'linkbtn', type: 'button', onclick: () => setAuth('register') }, 'Crear una cuenta'),
  );
}

function ForgotScreen() {
  const err = errorBox();
  const btn = h('button', { class: 'btn guava', type: 'submit' }, 'Enviar enlace');
  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true; btn.disabled = true;
    const email = form.email.value.trim().toLowerCase();
    try {
      const d = await api('/auth/forgot', { method: 'POST', body: { email } });
      setAuth('check', { kind: 'reset', email, message: d.message });
    } catch (ex) { showError(err, ex.message); btn.disabled = false; }
  } }, err, emailField(state.auth.email), btn);

  return authShell(
    h('div', { class: 'hero' }, h('h1', {}, 'Recupera tu contraseña.'), h('p', {}, 'Escribe tu correo y te enviamos un enlace para elegir una nueva. Dura 1 hora.')),
    form,
    h('button', { class: 'linkbtn', type: 'button', onclick: () => setAuth('login') }, 'Volver a entrar'),
  );
}

// Pantalla de "revisa tu correo" para confirmar la cuenta o para restablecer la contraseña
function CheckEmailScreen() {
  const { kind, email, message } = state.auth;
  const isReset = kind === 'reset';
  const label = 'Reenviar correo';
  const btn = h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
    btn.disabled = true;
    try {
      await api(isReset ? '/auth/forgot' : '/auth/resend-verification', { method: 'POST', body: { email } });
      toast('Listo. Revisa tu correo.');
    } catch (ex) { toast(ex.message); }
    cooldown(btn, label, 60);
  } }, label);

  return authShell(
    h('div', { class: 'hero' },
      h('h1', {}, 'Revisa tu correo.'),
      h('p', {}, message || (isReset ? 'Si existe una cuenta con ese correo, te enviamos un enlace.' : 'Te enviamos un enlace para confirmar tu cuenta.')),
      email ? h('p', { class: 'notice' }, email) : null,
      h('p', { class: 'muted small' }, '¿No llega? Busca en spam o promociones. Puede tardar un par de minutos.')),
    email ? btn : null,
    h('button', { class: 'linkbtn', type: 'button', onclick: () => setAuth('login', { email }) }, 'Volver a entrar'),
  );
}

function ResetScreen() {
  const err = errorBox();
  const btn = h('button', { class: 'btn guava', type: 'submit' }, 'Guardar contraseña');
  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (form.password.value !== form.confirm.value) return showError(err, 'Las contraseñas no coinciden.');
    btn.disabled = true;
    try {
      const d = await api('/auth/reset', { method: 'POST', body: { token: state.auth.resetToken, password: form.password.value } });
      state.token = d.token; store.set(d.token); state.user = d.user;
      state.auth = { view: 'login', email: '', message: '', kind: '', resetToken: null };
      history.replaceState({}, '', '/');
      toast('Contraseña actualizada.');
      await afterAuth();
    } catch (ex) {
      showError(err, ex.message); btn.disabled = false;
      if (ex.code === 'TOKEN_INVALID') form.replaceWith(h('button', { class: 'btn', type: 'button', onclick: () => { history.replaceState({}, '', '/'); setAuth('forgot'); } }, 'Pedir otro enlace'));
    }
  } },
    passwordField({ label: 'Nueva contraseña', name: 'password', autocomplete: 'new-password', hint: 'Mínimo 8 caracteres.' }),
    passwordField({ label: 'Repite la contraseña', name: 'confirm', autocomplete: 'new-password' }),
    btn,
  );

  return authShell(
    h('div', { class: 'hero' }, h('h1', {}, 'Elige una contraseña nueva.'), h('p', {}, 'Al guardarla cerramos tus otras sesiones abiertas.')),
    err, form,
  );
}

function WorkingScreen() {
  return authShell(h('div', { class: 'hero' }, h('h1', {}, state.auth.message || 'Un momento…')));
}

async function afterAuth() {
  if (state.user.profile && !state.user.locked) await loadPlan();
  render();
}

async function loadPlan() {
  try {
    const d = await api('/plan');
    state.plan = d.plan; state.photoInsight = d.photoInsight;
  } catch (e) { if (!state.user.locked) toast(e.message); }
}

/* ---------- Instalación PWA ---------- */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.deferredInstall = e;
  // No redibujar si la persona ya está escribiendo (perdería lo escrito)
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (!state.user && !typing && ['register', 'login'].includes(state.auth.view)) render();
});
window.addEventListener('appinstalled', () => { state.deferredInstall = null; toast('App instalada'); });

function installBanner() {
  if (!state.deferredInstall) return null;
  return h('div', { class: 'install' }, 'Instala NutriFit en tu teléfono',
    h('button', { class: 'btn small', type: 'button', onclick: async () => {
      state.deferredInstall.prompt();
      await state.deferredInstall.userChoice;
      state.deferredInstall = null; render();
    } }, 'Instalar'));
}

/* ---------- Onboarding / perfil ---------- */
function Onboarding() {
  const p = state.user.profile || {};
  let step = 1;
  const err = h('div', { class: 'error', hidden: true, role: 'alert' });
  const bar = h('div', { class: 'progress', 'aria-hidden': 'true' }, h('b', { class: 'on' }), h('b'));

  const radio = (name, value, label, checked, sub) =>
    h('label', {}, h('input', { type: 'radio', name, value, checked: checked || null, required: true }), h('span', {}, label, sub ? h('small', {}, sub) : null));

  const step1 = h('div', { class: 'form' },
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'heightCm' }, 'Estatura (cm)'), h('input', { class: 'input', id: 'heightCm', name: 'heightCm', type: 'number', inputmode: 'numeric', min: 120, max: 230, value: p.heightCm || '', required: true })),
      h('div', { class: 'field' }, h('label', { for: 'weightKg' }, 'Peso (kg)'), h('input', { class: 'input', id: 'weightKg', name: 'weightKg', type: 'number', inputmode: 'decimal', step: '0.1', min: 30, max: 300, value: p.weightKg || '', required: true }))),
    h('div', { class: 'field' }, h('label', { for: 'age' }, 'Edad'), h('input', { class: 'input', id: 'age', name: 'age', type: 'number', inputmode: 'numeric', min: 13, max: 100, value: p.age || '', required: true })),
    h('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Sexo' }, h('span', { class: 'label' }, 'Sexo'),
      h('div', { class: 'segmented' }, radio('sex', 'female', 'Mujer', p.sex === 'female'), radio('sex', 'male', 'Hombre', p.sex === 'male')),
      h('span', { class: 'hint' }, 'Lo usamos solo para calcular tus calorías.')),
  );

  const step2 = h('div', { class: 'form', hidden: true },
    h('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Actividad' }, h('span', { class: 'label' }, '¿Qué tan activo eres?'),
      h('div', { class: 'segmented activity' },
        radio('activity', 'sedentary', 'Casi nada', p.activity === 'sedentary', 'Trabajo sentado, poco movimiento'),
        radio('activity', 'light', 'Poco', p.activity === 'light', 'Ejercicio 1 a 3 días por semana'),
        radio('activity', 'moderate', 'Moderado', p.activity === 'moderate', 'Ejercicio 3 a 5 días por semana'),
        radio('activity', 'high', 'Mucho', p.activity === 'high', 'Ejercicio casi todos los días'))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'hasCondition', checked: p.hasCondition || null }),
      h('span', {}, 'Estoy embarazada, tengo diabetes u otra condición de salud, o he tenido un trastorno alimenticio.')),
    h('p', { class: 'notice small' }, 'NutriFit es informativa y no sustituye a un médico o nutriólogo. Si marcas la casilla, te daremos un plan general de mantenimiento.'),
  );

  const next = h('button', { class: 'btn', type: 'button' }, 'Siguiente');
  const back = h('button', { class: 'linkbtn', type: 'button', hidden: true }, 'Volver');
  const form = h('form', { class: 'form', novalidate: true });

  const setStep = (n) => {
    step = n;
    step1.hidden = n !== 1; step2.hidden = n !== 2; back.hidden = n !== 2;
    bar.children[1].className = n === 2 ? 'on' : '';
    next.textContent = n === 1 ? 'Siguiente' : 'Crear mi plan';
    err.hidden = true;
  };
  back.onclick = () => setStep(1);

  next.onclick = async () => {
    const f = form;
    if (step === 1) {
      const ok = f.heightCm.value && f.weightKg.value && f.age.value && f.sex.value;
      if (!ok) { err.textContent = 'Completa estatura, peso, edad y sexo.'; err.hidden = false; return; }
      return setStep(2);
    }
    if (!f.activity.value) { err.textContent = 'Elige qué tan activo eres.'; err.hidden = false; return; }
    next.disabled = true; err.hidden = true;
    try {
      const d = await api('/profile', { method: 'POST', body: {
        heightCm: f.heightCm.value, weightKg: f.weightKg.value, age: f.age.value,
        sex: f.sex.value, activity: f.activity.value, hasCondition: f.hasCondition.checked,
      } });
      state.user = d.user; state.plan = d.plan; state.editing = false; state.day = null; state.tab = 'plan';
      render();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; next.disabled = false; }
  };

  form.append(err, step1, step2, next, back);
  form.addEventListener('submit', (e) => e.preventDefault());

  return h('main', { class: 'screen' },
    h('div', { class: 'brand' }, h('i'), 'NutriFit'),
    bar,
    h('div', { class: 'section-title' }, h('h1', {}, state.user.profile ? 'Actualiza tus datos' : 'Cuéntanos de ti'), h('p', { class: 'muted' }, 'Con esto calculamos tu plan.')),
    form,
    state.user.profile ? h('button', { class: 'linkbtn', type: 'button', onclick: () => { state.editing = false; render(); } }, 'Cancelar') : null,
  );
}

/* ---------- Paywall ---------- */
function Paywall() {
  const err = h('div', { class: 'error', hidden: true, role: 'alert' });
  const btn = h('button', { class: 'btn guava', type: 'button', onclick: async () => {
    btn.disabled = true; err.hidden = true;
    try { const d = await api('/billing/checkout', { method: 'POST' }); location.href = d.url; }
    catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  } }, 'Seguir con el plan Pro');

  return h('main', { class: 'paywall' },
    h('div', { class: 'brand' }, h('i'), 'NutriFit'),
    h('h1', {}, 'Tu semana gratis terminó.'),
    h('p', {}, 'Para seguir con tu plan, adquiere el plan Pro. Tus datos y tu progreso te están esperando.'),
    h('ul', { class: 'perks' },
      h('li', {}, 'Comidas y bebidas para cada día'),
      h('li', {}, 'Rutinas que se ajustan a tu objetivo'),
      h('li', {}, 'Actualiza tu plan cuando cambie tu peso')),
    err, btn,
    h('button', { class: 'linkbtn', type: 'button', onclick: () => logout() }, 'Cerrar sesión'),
  );
}

/* ---------- App principal ---------- */
const ICONS = {
  plan: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
  drinks: '<svg viewBox="0 0 24 24"><path d="M6 3h12l-1.5 17a1 1 0 0 1-1 .9h-7a1 1 0 0 1-1-.9z"/><path d="M7 9h10"/></svg>',
  workout: '<svg viewBox="0 0 24 24"><path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12"/></svg>',
  me: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
};
const TABS = [['plan', 'Comida'], ['drinks', 'Bebidas'], ['workout', 'Rutina'], ['me', 'Perfil']];

async function renderApp() {
  if (!state.plan) await loadPlan();
  if (!state.plan) { // fallo de red o bloqueo
    if (state.user.locked) return render();
    return $app.append(h('main', { class: 'screen' }, h('p', {}, 'No pudimos cargar tu plan.'), h('button', { class: 'btn', onclick: () => renderApp() }, 'Reintentar')));
  }
  $app.replaceChildren();
  const u = state.user;
  const badge = u.isPro ? h('span', { class: 'badge pro' }, 'Plan Pro')
    : h('span', { class: 'badge' + (u.daysLeft <= 2 ? ' low' : '') }, u.daysLeft === 1 ? 'Último día gratis' : `Te quedan ${u.daysLeft} días gratis`);

  const views = { plan: PlanView, drinks: DrinksView, workout: WorkoutView, me: MeView };
  $app.append(
    h('div', { class: 'topbar' }, h('div', { class: 'brand' }, h('i'), 'NutriFit'), badge),
    h('main', { class: 'content' }, views[state.tab]()),
    h('div', { class: 'tabbar' }, h('nav', { 'aria-label': 'Secciones' },
      TABS.map(([id, label]) => h('button', { class: 'tab', type: 'button', 'aria-current': state.tab === id ? 'page' : null,
        onclick: () => { state.tab = id; renderApp(); window.scrollTo(0, 0); } },
        h('span', { html: ICONS[id === 'drinks' ? 'drinks' : id] }), label)))),
  );
}

/* --- Comida --- */
const WHEN = { desayuno: 'Desayuno', comida: 'Comida', snack: 'Colación', cena: 'Cena' };

function plateSVG(kcal, proteinG) {
  const pk = proteinG * 4, fk = kcal * 0.28;
  const ck = Math.max(kcal - pk - fk, kcal * 0.2);
  const tot = pk + fk + ck;
  const r = 44, C = 2 * Math.PI * r, gap = 3;
  let off = 0;
  const arc = (frac, color) => {
    const len = Math.max(frac * C - gap, 1);
    const s = `<circle class="arc" cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"/>`;
    off += frac * C; return s;
  };
  const html = `<svg viewBox="0 0 120 120" role="img" aria-label="Distribución de tus calorías: proteína, carbohidratos y grasas">
    <circle cx="60" cy="60" r="58" fill="#fff" stroke="#e3deee" stroke-width="1.5"/>
    <circle cx="60" cy="60" r="52" fill="none" stroke="#f1eef8" stroke-width="1.5"/>
    ${arc(pk / tot, '#ef4b6c')}${arc(ck / tot, '#ff9a56')}${arc(fk / tot, '#cfe86b')}
  </svg>`;
  return html;
}

function PlanView() {
  const plan = state.plan, m = plan.metrics;
  if (state.day == null) state.day = (new Date().getDay() + 6) % 7;
  const day = plan.week[state.day];
  const ins = state.photoInsight;

  return h('div', { class: 'content', style: 'padding:0;gap:22px' },
    h('div', { class: 'plate-wrap' },
      h('div', { class: 'plate' }, h('div', { html: plateSVG(m.targetKcal, m.proteinG) }),
        h('div', { class: 'center' }, h('div', { class: 'kcal' }, m.targetKcal.toLocaleString('es-MX')), h('div', { class: 'unit' }, 'kcal al día'))),
      h('div', { class: 'legend' },
        h('span', { style: '--c:#ef4b6c' }, 'Proteína'), h('span', { style: '--c:#ff9a56' }, 'Carbohidratos'), h('span', { style: '--c:#cfe86b' }, 'Grasas')),
      h('div', { class: 'headline' }, h('h2', {}, plan.headline), h('p', { class: 'muted' }, `IMC ${m.bmi} · ${m.category}`))),
    h('div', { class: 'stats' },
      h('div', {}, h('b', {}, m.proteinG + ' g'), h('span', {}, 'proteína al día')),
      h('div', {}, h('b', {}, m.waterL + ' L'), h('span', {}, 'agua al día')),
      h('div', {}, h('b', {}, m.tdee.toLocaleString('es-MX')), h('span', {}, 'kcal que gastas'))),
    ...plan.warnings.map((w) => h('p', { class: 'notice warn' }, w)),
    ...plan.notes.map((n) => h('p', { class: 'notice' }, n)),
    ins && ins.recomendaciones && ins.recomendaciones.length
      ? h('div', { class: 'photo-result' }, h('b', {}, 'Según tu foto'), ...ins.recomendaciones.map((r) => h('span', {}, r))) : null,
    h('div', { class: 'days', role: 'group', 'aria-label': 'Día de la semana' },
      plan.week.map((d, i) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(i === state.day), onclick: () => { state.day = i; renderApp(); } }, d.day))),
    h('div', { class: 'list' },
      day.items.map((it) => h('details', { class: 'meal' },
        h('summary', {}, h('span', { class: 'when' }, WHEN[it.type]), h('span', { class: 'name' }, it.name),
          h('span', { class: 'kc' }, it.kcalAdjusted, h('small', {}, 'kcal'))),
        h('p', { class: 'body' }, it.steps + (day.portionFactor !== 1 ? ` Ajusta la porción a ~${Math.round(day.portionFactor * 100)}% de lo indicado.` : ''))))),
    h('p', { class: 'muted small' }, plan.disclaimer),
  );
}

/* --- Bebidas --- */
function DrinksView() {
  return h('div', { class: 'content', style: 'padding:0' },
    h('div', { class: 'section-title' }, h('h2', {}, 'Qué tomar'), h('p', { class: 'muted' }, `Tu meta de agua: ${state.plan.metrics.waterL} litros al día.`)),
    h('div', { class: 'list' }, state.plan.drinks.map((d) =>
      h('div', { class: 'drink' }, h('div', { class: 'dot' }), h('div', {}, h('b', {}, `${d.name} · ${d.kcal} kcal`), h('span', {}, d.note))))));
}

/* --- Rutina --- */
function WorkoutView() {
  const today = (new Date().getDay() + 6) % 7;
  return h('div', { class: 'content', style: 'padding:0' },
    h('div', { class: 'section-title' }, h('h2', {}, 'Tu rutina semanal'), h('p', { class: 'muted' }, 'Calienta 5 minutos antes y para si algo te duele.')),
    h('div', { class: 'list' }, state.plan.workouts.map((w, i) =>
      h('details', { class: 'workout', open: i === today || null },
        h('summary', {}, h('div', {}, h('div', { class: 'day' }, w.day + (i === today ? ' (hoy)' : '')), h('div', { class: 'muted small' }, w.title)),
          h('span', { class: 'mins' }, w.minutes ? w.minutes + ' min' : 'Descanso')),
        h('ul', {}, w.exercises.map((e) => h('li', {}, e)))))));
}

/* --- Perfil --- */
function MeView() {
  const u = state.user, p = u.profile;
  const sexLabel = p.sex === 'male' ? 'Hombre' : 'Mujer';
  const actLabel = { sedentary: 'Casi nada', light: 'Poco', moderate: 'Moderado', high: 'Mucho' }[p.activity];

  return h('div', { class: 'content', style: 'padding:0' },
    h('div', { class: 'section-title' }, h('h2', {}, 'Tu perfil'), h('p', { class: 'muted' }, u.email)),
    h('div', { class: 'card' },
      h('div', { class: 'kv' }, h('span', {}, 'Estatura'), h('b', {}, p.heightCm + ' cm')),
      h('div', { class: 'kv' }, h('span', {}, 'Peso'), h('b', {}, p.weightKg + ' kg')),
      h('div', { class: 'kv' }, h('span', {}, 'Edad'), h('b', {}, p.age + ' años')),
      h('div', { class: 'kv' }, h('span', {}, 'Sexo'), h('b', {}, sexLabel)),
      h('div', { class: 'kv' }, h('span', {}, 'Actividad'), h('b', {}, actLabel)),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { state.editing = true; render(); } }, 'Actualizar mis datos')),
    PhotoCard(),
    installBanner(),
    u.isPro && u.billingEnabled ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
      try { const d = await api('/billing/portal', { method: 'POST' }); location.href = d.url; } catch (e) { toast(e.message); }
    } }, 'Administrar mi suscripción') : null,
    !u.isPro ? h('button', { class: 'btn guava', type: 'button', onclick: async () => {
      try { const d = await api('/billing/checkout', { method: 'POST' }); location.href = d.url; } catch (e) { toast(e.message); }
    } }, 'Pasar al plan Pro') : null,
    h('button', { class: 'btn ghost', type: 'button', onclick: () => logout() }, 'Cerrar sesión'),
    h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!confirm('Se borrará tu cuenta, tus datos y tu suscripción. Esta acción no se puede deshacer. ¿Continuar?')) return;
      try { await api('/account', { method: 'DELETE' }); logout(true); toast('Tu cuenta y tus datos se borraron'); } catch (e) { toast(e.message); }
    } }, 'Borrar mi cuenta y mis datos'),
  );
}

/* --- Foto (opcional) --- */
function resizeImage(file, max = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); // re-dibujar elimina metadatos EXIF (ubicación, etc.)
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo preparar la imagen.'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No pudimos leer esa imagen.')); };
    img.src = url;
  });
}

function PhotoCard() {
  const u = state.user;
  if (u.profile.age < 18) return null;
  const out = h('div');
  const err = h('div', { class: 'error', hidden: true, role: 'alert' });
  const consent = h('input', { type: 'checkbox', id: 'consent' });
  const file = h('input', { type: 'file', accept: 'image/*', id: 'photo', class: 'input' });
  const btn = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    err.hidden = true;
    if (!consent.checked) { err.textContent = 'Acepta el aviso de privacidad para continuar.'; err.hidden = false; return; }
    if (!file.files[0]) { err.textContent = 'Elige o toma una foto de cuerpo completo.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Analizando…';
    try {
      const blob = await resizeImage(file.files[0]);
      const fd = new FormData();
      fd.append('consent', 'true'); fd.append('photo', blob, 'foto.jpg');
      const d = await api('/photo', { method: 'POST', body: fd });
      state.photoInsight = d.photoInsight; file.value = ''; consent.checked = false;
      toast('Listo. Ajustamos tus recomendaciones.');
      out.replaceChildren(InsightBox(d.photoInsight));
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    btn.disabled = false; btn.textContent = 'Analizar mi foto';
  } }, 'Analizar mi foto');

  if (state.photoInsight) out.append(InsightBox(state.photoInsight));

  return h('div', { class: 'card' },
    h('h3', {}, 'Foto de cuerpo completo (opcional)'),
    h('p', { class: 'muted small' }, 'Sirve para afinar tus recomendaciones. Tu plan funciona igual sin ella.'),
    h('div', { class: 'privacy' },
      h('b', {}, 'Tu imagen es privada'),
      h('span', {}, u.photoAI
        ? 'La analizamos en el momento con un servicio de IA, solo para descubrir tus necesidades de dieta y ejercicio. No guardamos la foto: solo un resumen en texto. Quitamos los datos de ubicación antes de enviarla.'
        : 'La analizamos en el momento, solo para descubrir tus necesidades de dieta y ejercicio. No guardamos la foto: solo un resumen en texto.')),
    h('label', { class: 'check', for: 'consent' }, consent, h('span', {}, 'Entiendo cómo se usará mi foto y acepto enviarla.')),
    h('label', { class: 'sr', for: 'photo', style: 'position:absolute;left:-9999px' }, 'Foto de cuerpo completo'),
    file, err, btn, out);
}

function InsightBox(i) {
  return h('div', { class: 'photo-result' },
    h('b', {}, 'Resultado'),
    h('span', {}, `Complexión: ${i.complexion || 'no determinada'}`),
    i.distribucion ? h('span', {}, i.distribucion) : null,
    ...(i.recomendaciones || []).map((r) => h('span', {}, '• ' + r)),
    h('span', { class: 'muted small' }, 'Es una estimación general, no un diagnóstico.'));
}

/* ---------- Arranque ---------- */
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  const q = new URLSearchParams(location.search);
  const route = location.pathname.replace(/\/+$/, '');

  // Enlace de "restablecer contraseña" que llegó por correo
  if (route === '/reset-password' && q.get('token')) {
    const token = q.get('token');
    history.replaceState({}, '', '/reset-password'); // quita el token de la barra de direcciones
    state.token = null; state.user = null;
    state.auth = { view: 'reset', email: '', message: '', kind: '', resetToken: token };
    return render();
  }

  // Enlace de "confirmar correo": la app lo canjea con un POST y entra a la cuenta
  if (route === '/verify-email' && q.get('token')) {
    const token = q.get('token');
    history.replaceState({}, '', '/');
    state.token = null; state.user = null;
    state.auth = { view: 'working', email: '', message: 'Confirmando tu correo…', kind: '', resetToken: null };
    render();
    try {
      const d = await api('/auth/verify-email', { method: 'POST', body: { token } });
      state.token = d.token; store.set(d.token); state.user = d.user;
      toast('¡Correo confirmado! Tu semana gratis ya empezó.', 5000);
      return afterAuth();
    } catch (ex) {
      toast(ex.message, 6000);
      return setAuth('login');
    }
  }

  if (state.token) {
    try {
      const d = await api('/me');
      state.user = d.user;
      if (state.user.profile && !state.user.locked) await loadPlan();
    } catch { /* sin conexión o sesión vencida: se muestra el login */ }
  }

  // Regreso desde Stripe: esperar a que el webhook active el plan Pro
  if (q.has('paid') && state.token) {
    history.replaceState({}, '', '/');
    toast('Confirmando tu pago…');
    for (let i = 0; i < 10; i++) {
      try { const d = await api('/me'); state.user = d.user; if (d.user.isPro) { toast('¡Listo! Ya tienes el plan Pro.'); break; } } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (state.user && state.user.profile) await loadPlan();
  } else if (q.has('canceled')) { history.replaceState({}, '', '/'); toast('El pago se canceló. Puedes intentarlo cuando quieras.'); }

  if (!state.user) state.auth.view = store.seen() ? 'login' : 'register';
  render();
}

boot();
