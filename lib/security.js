const crypto = require('crypto');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

// Correo "canonico": quita el alias (+algo) y los puntos de Gmail para que
// juan@gmail.com, j.uan@gmail.com y juan+2@gmail.com cuenten como la misma cuenta
// (evita repetir la semana gratis con alias). No detiene correos desechables.
function canonicalEmail(email) {
  const at = email.lastIndexOf('@');
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const noTag = local.split('+')[0];
  if (noTag) local = noTag;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '') || local;
  return `${local}@${domain}`;
}

// bcrypt solo usa los primeros 72 bytes, por eso se pone ese tope.
function passwordError(password, email) {
  if (typeof password !== 'string' || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'La contraseña es demasiado larga (máximo 72 caracteres).';
  if (email && password.toLowerCase() === email) return 'La contraseña no puede ser igual a tu correo.';
  return null;
}

// Token aleatorio para enlaces de correo. Al usuario se le manda `token`; en la base solo se guarda `hash`.
function newToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = { normalizeEmail, isValidEmail, canonicalEmail, passwordError, newToken, hashToken };
