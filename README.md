# NutriFit

PWA de nutrición y ejercicio, instalable en Android. Prueba gratis de 7 días, plan Pro con Stripe, base de datos en Supabase y correos opcionales con Resend.

Esta versión ya no usa archivos JSON: todo se guarda en Supabase (PostgreSQL). Los usuarios de la versión de prueba anterior no se migran.

## Qué incluye

- Cuentas con "olvidé mi contraseña" (requiere Resend), confirmación de correo opcional y cierre de sesiones al cambiar la contraseña.
- Plan según IMC y calorías (Mifflin-St Jeor), con topes de seguridad (mínimo 1,500 kcal hombres y 1,200 mujeres; sin planes de pérdida de peso para menores).
- La semana gratis empieza al crear la cuenta (o al confirmar el correo, si activas `REQUIRE_EMAIL_VERIFICATION=true`). Al terminar, el servidor bloquea el plan (HTTP 402) y la app muestra el paywall con el pago de Stripe.
- Suscripción con Stripe Checkout y portal de clientes. El webhook activa y desactiva el plan Pro.
- Foto opcional: con consentimiento, solo mayores de 18, no se guarda (solo un resumen en texto), con límite diario por persona.
- Borrar cuenta y datos desde el perfil.

---

## Paso 1. Supabase (base de datos)

1. Crea un proyecto en https://supabase.com. Guarda la contraseña de la base de datos que te pide.
2. Abre **SQL Editor > New query**, pega todo el contenido de `supabase/schema.sql` y presiona **Run**. Crea las tablas `users` y `email_tokens` con seguridad por filas (RLS) activada y sin políticas: nadie entra con la clave pública, solo tu servidor.
3. Copia dos datos:
   - **URL del proyecto** (`https://xxxx.supabase.co`), en el botón **Connect** o en la configuración de API del proyecto.
   - **Clave secreta** (`sb_secret_...`), en **Settings > API Keys**. Si no ves una, crea una ahí. Los proyectos más viejos tienen la clave `service_role`: también sirve, ponla en `SUPABASE_SERVICE_ROLE_KEY`.
4. La clave secreta se salta toda la seguridad de la base de datos. Úsala solo en el servidor (Render), nunca en el navegador ni en GitHub.

## Paso 2. Resend (correos, opcional por ahora)

Puedes lanzar sin este paso: las cuentas quedan confirmadas al registrarse y la prueba empieza de inmediato. Lo único que no funcionará es "¿Olvidaste tu contraseña?" (la app oculta ese enlace). Haz este paso cuando quieras recuperación de contraseña o confirmación de correo.

1. Crea una cuenta en https://resend.com.
2. **Domains > Add Domain**: agrega tu dominio (por ejemplo `tudominio.com`) y crea en tu proveedor de DNS los registros que Resend te muestra (SPF y DKIM). Espera a que aparezca como verificado.
3. **API Keys > Create API Key** con permiso de envío. Cópiala (`re_...`).
4. Define `EMAIL_FROM` con una dirección de ese dominio, por ejemplo `NutriFit <no-reply@tudominio.com>`.

Sin un dominio verificado, Resend solo deja enviar pruebas a tu propio correo, así que ninguna otra persona recibiría sus enlaces. Verifica el dominio antes de poner la clave de Resend en producción.

## Paso 3. Stripe

1. En https://dashboard.stripe.com crea un producto con precio **recurrente** y copia el `price_...` a `STRIPE_PRICE_ID`.
2. Copia tu clave secreta a `STRIPE_SECRET_KEY` (`sk_test_...` para probar, `sk_live_...` para cobrar de verdad; para la clave live primero activa tu cuenta con los datos del negocio).
3. **Developers > Webhooks > Add endpoint**:
   - URL: `https://TU-DOMINIO/api/stripe/webhook`
   - Eventos: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copia el **Signing secret** (`whsec_...`) a `STRIPE_WEBHOOK_SECRET`.
4. Activa el **portal de clientes** en la configuración de facturación de Stripe para que funcione el botón "Administrar mi suscripción".
5. Si cambias de claves de prueba a live, el webhook y el precio también deben ser los de live.

## Paso 4. Publicar en Render

1. Sube el proyecto a un repositorio de GitHub (el `.gitignore` ya excluye `.env` y `node_modules`).
2. En https://render.com: **New > Web Service**, elige tu repositorio y configura:
   - Runtime: **Node**
   - Build command: `npm install --omit=dev`
   - Start command: `npm start`
   - Health check path: `/healthz`
   
   También puedes usar **New > Blueprint**: Render lee `render.yaml` y te pide los valores secretos.
3. En **Environment** agrega estas variables:

| Variable | Obligatoria | Qué poner |
|---|---|---|
| `NODE_ENV` | Sí | `production` |
| `NODE_VERSION` | Sí | `22` |
| `APP_URL` | Sí | La dirección pública con https y sin `/` al final, por ejemplo `https://nutrifit.onrender.com` o tu dominio |
| `JWT_SECRET` | Sí | Texto aleatorio de 32 o más caracteres. Genera uno con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `SUPABASE_URL` | Sí | URL de tu proyecto de Supabase |
| `SUPABASE_SECRET_KEY` | Sí | Clave secreta `sb_secret_...` (o `SUPABASE_SERVICE_ROLE_KEY` si usas la antigua) |
| `REQUIRE_EMAIL_VERIFICATION` | No | `false` (por defecto): la cuenta queda confirmada al registrarse y la prueba empieza de inmediato. `true`: hay que confirmar el correo (necesita Resend con dominio verificado) |
| `RESEND_API_KEY` | No* | Clave `re_...` de Resend. *Obligatoria solo si `REQUIRE_EMAIL_VERIFICATION=true`. Sin ella no hay "¿Olvidaste tu contraseña?" |
| `EMAIL_FROM` | No* | `NutriFit <no-reply@tudominio.com>` (dominio verificado en Resend). *Obligatoria si `REQUIRE_EMAIL_VERIFICATION=true` |
| `STRIPE_SECRET_KEY` | Para cobrar | `sk_live_...` (o `sk_test_...` para probar) |
| `STRIPE_WEBHOOK_SECRET` | Si usas Stripe | `whsec_...` del webhook de producción |
| `STRIPE_PRICE_ID` | Si usas Stripe | `price_...` de tu suscripción |
| `ANTHROPIC_API_KEY` | No | Solo si quieres el análisis de foto con IA. Vacía = en producción la función de foto no aparece en la app (en tu computadora sí, con un resultado simulado para probar) |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-5-5` (valor por defecto) |
| `PHOTO_DAILY_LIMIT` | No | Análisis de foto por persona cada 24 h (por defecto `5`) |
| `TRIAL_DAYS` | No | Días de prueba (por defecto `7`) |

4. Si falta una variable obligatoria, el servidor **no arranca** y los registros (Logs) de Render dicen exactamente cuál.
5. Después del primer despliegue, copia la URL final a `APP_URL` si cambió y crea el webhook de Stripe con ella.

Notas de Render:
- Los servicios del plan gratuito suelen dormirse tras un rato sin visitas. Para cobrar a personas conviene un plan de pago.
- Los límites de intentos (login, correos) se guardan en memoria: usa **una sola instancia**. Si algún día escalas a varias, hay que moverlos a la base de datos.

## Paso 5. Probar antes de abrirla al público

1. Abre tu URL y crea una cuenta. Debe entrar directo a la app y mostrar "Te quedan 7 días gratis".
2. Cierra sesión e intenta crear otra cuenta con el mismo correo (o con un alias como `tu.correo+2@gmail.com`): debe decir que ya existe.
3. Si configuraste Resend: prueba "¿Olvidaste tu contraseña?" y cambia la contraseña con el enlace. Si no, comprueba que ese enlace no aparece.
4. Llena el perfil y revisa el plan.
5. Simula el fin de la prueba: en Supabase, **Table Editor > users**, pon `trial_started_at` hace 8 días. Al recargar debe aparecer el paywall.
6. Paga con una tarjeta de prueba de Stripe (modo test) y confirma que `is_pro` cambia a `true` en la tabla.
7. En Chrome para Android abre la URL y toca **Instalar** (o menú ⋮ > Instalar app).
8. Prueba "Borrar mi cuenta y mis datos" con una cuenta de prueba.

## Cómo funciona la seguridad de cuentas

- Las contraseñas se guardan con bcrypt. Máximo 72 caracteres (límite de bcrypt).
- Los enlaces de correo son aleatorios, de un solo uso, y en la base solo se guarda su hash. Confirmar dura 24 horas; restablecer, 1 hora. Solo el último enlace pedido funciona.
- El enlace del correo abre la app y esta lo canjea con un POST, así los escáneres de correo que abren enlaces no lo gastan.
- Registro, "olvidé mi contraseña" y reenvío responden igual exista o no el correo, para no revelar quién tiene cuenta. El login también tarda lo mismo.
- Hay pausa de 60 segundos entre correos a la misma cuenta y límites por IP y por correo.
- Alias como `juan+2@gmail.com` o `j.uan@gmail.com` cuentan como la misma cuenta, para no repetir la semana gratis. No detiene correos desechables.
- Si alguien se registra con un correo que su dueño aún no confirmó, la contraseña más reciente reemplaza a la anterior. Así nadie conserva acceso a la cuenta de otra persona.
- Al restablecer la contraseña se cierran todas las demás sesiones y se envía un aviso por correo.
- La sesión es un token de 30 días guardado en el navegador. La política de seguridad de contenido (CSP) del servidor limita el riesgo de scripts ajenos.
- La foto nunca se guarda: se procesa en memoria. Si usas `ANTHROPIC_API_KEY`, se envía al servicio de análisis de Anthropic en cada petición; dilo en tu aviso de privacidad.

## Lanzar sin confirmar el correo: lo que debes saber

Por defecto (`REQUIRE_EMAIL_VERIFICATION=false`) la cuenta queda confirmada al crearse y la prueba de 7 días empieza de inmediato. Es más simple, pero tiene costos:

- **No se comprueba que el correo sea de quien se registra.** Si alguien usa el correo de otra persona antes que ella, esa persona no podrá registrarse con él. Con Resend activo puede recuperar la cuenta con "¿Olvidaste tu contraseña?"; sin Resend, tendrías que borrar esa cuenta a mano en Supabase.
- **Es más fácil repetir la semana gratis.** Los alias de Gmail (`juan+2@gmail.com`, `j.uan@gmail.com`) ya cuentan como la misma cuenta, pero un correo nuevo o desechable abre otra prueba. Hay un límite de 10 registros por hora por conexión. Si ves abuso, activa la verificación o pide la tarjeta al empezar la prueba.
- **Los errores de escritura quedan como cuentas válidas** (`juan@gmial.com`), y esa persona no podría recuperar su contraseña.
- **Sin Resend no hay "¿Olvidaste tu contraseña?"**: la app oculta el enlace y el servidor lo rechaza. Quien olvide su contraseña tendrá que escribirte, y la salida es borrar su cuenta en Supabase para que se registre de nuevo (pierde su plan).
- **Para activar la verificación más adelante:** verifica tu dominio en Resend (paso 2), pon `REQUIRE_EMAIL_VERIFICATION=true`, `RESEND_API_KEY` y `EMAIL_FROM` en Render y vuelve a desplegar. Las cuentas que ya existen siguen confirmadas.

## En tu computadora

```bash
npm install
cp .env.example .env     # llena SUPABASE_URL y SUPABASE_SECRET_KEY como mínimo
npm start                # http://localhost:3000
```

Sin `RESEND_API_KEY`, los enlaces de restablecer (y los de confirmar, si activas la verificación) se imprimen en la consola. Sin Stripe, el botón de pago avisa que no está configurado. `npm run check` revisa que todos los archivos compilen. `npm test` corre 72 pruebas automáticas (seguridad de cuentas, configuración, correos, plan, capa de datos y el flujo completo de registro, 7 días de prueba, bloqueo y pago), todas con piezas simuladas: Supabase, Stripe, express y bcrypt. No sustituyen la prueba real del paso 5.

## Antes de cobrar a personas reales

- **Textos legales:** `public/privacidad.html` y `public/terminos.html` son plantillas con [corchetes] por llenar. Un abogado debe revisarlas. Si no usas `ANTHROPIC_API_KEY`, quita de `privacidad.html` la línea de Anthropic; si no usas Resend, la de Resend. Los datos de salud son sensibles bajo la ley mexicana de protección de datos personales (se reformó en 2025; confirma la versión vigente) y requieren consentimiento expreso.
- **Contenido:** que un nutriólogo o entrenador revise `lib/data.js` y el cálculo de calorías.
- **Impuestos y facturación:** consulta con un contador cómo declarar y facturar los cobros.
- **Respaldos:** revisa en Supabase qué respaldos incluye tu plan.
- **Limpieza:** `supabase/schema.sql` trae al final dos consultas opcionales para borrar cuentas sin confirmar y tokens vencidos.

## Estructura

```
server.js            API, cuentas, Stripe, foto
lib/config.js        valida las variables de entorno al arrancar
lib/db.js            acceso a Supabase
lib/security.js      correos canónicos, contraseñas, tokens
lib/mailer.js        correos con Resend
lib/plan.js          cálculo de calorías y armado del plan
lib/data.js          recetas, bebidas y rutinas
supabase/schema.sql  tablas y seguridad (se ejecuta una vez)
test/                pruebas automáticas (npm test)
public/              la PWA (index.html, app.js, styles.css, sw.js, manifest, íconos, páginas legales)
render.yaml          configuración opcional para Render
```
