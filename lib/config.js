const crypto = require('crypto');

const isSet = (v) => !!v && !String(v).includes('xxx') && !String(v).startsWith('cambia-esto');

// Lee y valida las variables de entorno al arrancar.
// En producción, si falta algo importante el servidor NO arranca y dice qué falta.
function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);
  const appUrl = (env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, '');

  const errors = [];
  const warnings = [];

  const supabaseKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isSet(env.SUPABASE_URL)) errors.push('SUPABASE_URL (la URL de tu proyecto en Supabase).');
  if (!isSet(supabaseKey)) errors.push('SUPABASE_SECRET_KEY (clave secreta de Supabase, empieza con sb_secret_).');

  let jwtSecret = env.JWT_SECRET;
  if (!isSet(jwtSecret) || jwtSecret.length < 32) {
    if (isProd) errors.push('JWT_SECRET (aleatorio, de al menos 32 caracteres).');
    else {
      jwtSecret = crypto.randomBytes(32).toString('hex');
      warnings.push('JWT_SECRET no configurado: se usa uno temporal y las sesiones se pierden al reiniciar.');
    }
  }

  // Confirmar el correo al registrarse: apagado por defecto. Apagado, la cuenta queda confirmada al crearse y la
  // prueba gratis empieza de inmediato. Encendido, hace falta Resend con un dominio verificado.
  const requireEmailVerification = String(env.REQUIRE_EMAIL_VERIFICATION || '').trim().toLowerCase() === 'true';

  const resendKey = isSet(env.RESEND_API_KEY) ? env.RESEND_API_KEY : null;
  if (isProd) {
    if (!appUrl.startsWith('https://')) errors.push('APP_URL debe empezar con https:// en producción.');
    if (requireEmailVerification) {
      if (!resendKey) errors.push('RESEND_API_KEY (clave de Resend; necesaria porque REQUIRE_EMAIL_VERIFICATION=true).');
      if (!isSet(env.EMAIL_FROM)) errors.push('EMAIL_FROM (ej. NutriFit <no-reply@tudominio.com>).');
    } else if (!resendKey) {
      warnings.push('RESEND_API_KEY no configurado: las cuentas se confirman solas y la opción "¿Olvidaste tu contraseña?" no estará disponible.');
    } else if (!isSet(env.EMAIL_FROM)) {
      warnings.push('EMAIL_FROM no configurado: mientras no verifiques un dominio en Resend, solo se entregan correos a tu propia dirección.');
    }
  } else if (!resendKey) {
    warnings.push('RESEND_API_KEY no configurado: los enlaces de correo se imprimen en esta consola.');
  }

  const stripeKey = isSet(env.STRIPE_SECRET_KEY) ? env.STRIPE_SECRET_KEY : null;
  if (stripeKey) {
    if (!isSet(env.STRIPE_WEBHOOK_SECRET)) errors.push('STRIPE_WEBHOOK_SECRET (sin él, las personas pagan pero no se activa el plan Pro).');
    if (!isSet(env.STRIPE_PRICE_ID)) errors.push('STRIPE_PRICE_ID (el precio de la suscripción, empieza con price_).');
    if (isProd && stripeKey.startsWith('sk_test_')) warnings.push('Estás usando una clave de PRUEBA de Stripe en producción: no se cobrará dinero real.');
  } else {
    warnings.push('Stripe no está configurado: el botón de pago avisará que faltan las claves.');
  }

  if (errors.length) {
    const msg = ['', 'No se puede arrancar NutriFit. Faltan estas variables de entorno:', ...errors.map((e) => `  - ${e}`), '', 'Revisa la sección de variables del README.', ''].join('\n');
    const err = new Error(msg);
    err.fatalConfig = true;
    throw err;
  }

  return {
    isProd,
    port,
    appUrl,
    jwtSecret,
    trialDays: Number(env.TRIAL_DAYS || 7),
    photoDailyLimit: Number(env.PHOTO_DAILY_LIMIT || 5),
    requireEmailVerification,
    resendKey,
    // ¿Se pueden mandar correos? (en tu computadora se imprimen en consola, así que cuenta como sí)
    emailEnabled: !!resendKey || !isProd,
    emailFrom: env.EMAIL_FROM || 'NutriFit <onboarding@resend.dev>',
    stripe: stripeKey ? { secretKey: stripeKey, webhookSecret: env.STRIPE_WEBHOOK_SECRET, priceId: env.STRIPE_PRICE_ID } : null,
    anthropic: isSet(env.ANTHROPIC_API_KEY) ? { key: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' } : null,
    warnings,
  };
}

module.exports = { loadConfig };
