// Envío de correos con Resend (https://resend.com/docs/api-reference/emails/send-email)
// Usa fetch directo: no necesita librerías extra.

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ title, intro, buttonText, link, outro }) {
  const safeLink = escapeHtml(link || '');
  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f2f9;font-family:Arial,Helvetica,sans-serif;color:#241b3a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:28px">
      <tr><td style="font-size:20px;font-weight:bold;padding-bottom:16px">NutriFit</td></tr>
      <tr><td style="font-size:22px;font-weight:bold;padding-bottom:12px">${escapeHtml(title)}</td></tr>
      <tr><td style="font-size:15px;line-height:1.5;padding-bottom:20px">${escapeHtml(intro)}</td></tr>
      ${link ? `<tr><td style="padding-bottom:20px"><a href="${safeLink}" style="display:inline-block;background:#ef4b6c;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:12px">${escapeHtml(buttonText)}</a></td></tr>
      <tr><td style="font-size:12px;color:#6b6384;padding-bottom:16px;word-break:break-all">Si el botón no funciona, copia este enlace en tu navegador:<br>${safeLink}</td></tr>` : ''}
      <tr><td style="font-size:13px;color:#6b6384;line-height:1.5">${escapeHtml(outro)}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function createMailer({ resendKey, emailFrom, isProd }) {
  async function send({ to, subject, html, text }) {
    if (!resendKey) {
      if (isProd) throw new Error('RESEND_API_KEY no configurado.');
      console.log(`\n[correo simulado] Para: ${to}\nAsunto: ${subject}\n${text}\n`);
      return { simulated: true };
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend respondió ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  const make = ({ title, intro, buttonText, link, outro }) => ({
    html: layout({ title, intro, buttonText, link, outro }),
    text: [title, '', intro, link ? `\n${buttonText}: ${link}` : '', '', outro].join('\n'),
  });

  return {
    sendVerification(to, link) {
      return send({ to, subject: 'Confirma tu correo en NutriFit', ...make({
        title: 'Confirma tu correo',
        intro: 'Toca el botón para activar tu cuenta. Tu semana gratis empieza en cuanto confirmes.',
        buttonText: 'Confirmar mi correo',
        link,
        outro: 'El enlace dura 24 horas y solo funciona una vez. Si no creaste una cuenta en NutriFit, ignora este correo.',
      }) });
    },
    sendPasswordReset(to, link) {
      return send({ to, subject: 'Restablece tu contraseña de NutriFit', ...make({
        title: 'Restablece tu contraseña',
        intro: 'Recibimos una solicitud para cambiar la contraseña de tu cuenta. Toca el botón para elegir una nueva.',
        buttonText: 'Elegir nueva contraseña',
        link,
        outro: 'El enlace dura 1 hora y solo funciona una vez. Si no lo pediste, ignora este correo: tu contraseña no cambiará.',
      }) });
    },
    sendAccountExists(to, link) {
      return send({ to, subject: 'Ya tienes una cuenta en NutriFit', ...make({
        title: 'Ya tienes una cuenta',
        intro: 'Alguien intentó crear una cuenta con este correo, pero ya existe una. Entra con tu contraseña. Si no la recuerdas, usa "¿Olvidaste tu contraseña?" en la pantalla de entrada.',
        buttonText: 'Ir a NutriFit',
        link,
        outro: 'Si no fuiste tú, no necesitas hacer nada.',
      }) });
    },
    sendPasswordChanged(to) {
      return send({ to, subject: 'Tu contraseña de NutriFit cambió', ...make({
        title: 'Tu contraseña cambió',
        intro: 'Acabas de cambiar la contraseña de tu cuenta y cerramos tus otras sesiones.',
        outro: 'Si no fuiste tú, restablece tu contraseña de inmediato desde la pantalla de entrada.',
      }) });
    },
  };
}

module.exports = { createMailer };
