-- NutriFit: esquema para Supabase (PostgreSQL)
-- Ejecuta este archivo completo en Supabase > SQL Editor > New query > Run.
-- Es seguro volver a correrlo: usa "if not exists".

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------
create table if not exists public.users (
  id                      uuid primary key default gen_random_uuid(),
  email                   text not null,                 -- como lo escribio la persona (en minusculas)
  email_canonical         text not null unique,          -- sin alias (+tag) ni puntos de Gmail; evita cuentas duplicadas
  password_hash           text not null,
  email_verified_at       timestamptz,                   -- null = aun no confirma su correo
  trial_started_at        timestamptz,                   -- se llena al confirmar el correo
  is_pro                  boolean not null default false,
  stripe_customer_id      text unique,
  stripe_subscription_id  text,
  profile                 jsonb,                         -- estatura, peso, edad, sexo, actividad
  photo_insight           jsonb,                         -- solo el resumen en texto; la foto nunca se guarda
  photo_count             integer not null default 0,    -- analisis de foto usados en la ventana actual
  photo_window_start      timestamptz,
  token_version           integer not null default 0,    -- al subirlo se invalidan todas las sesiones
  terms_accepted_at       timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists users_created_at_idx on public.users (created_at);

-- ---------------------------------------------------------------
-- Enlaces de un solo uso por correo (verificar, restablecer, avisos)
-- Se guarda solo el hash del token, nunca el token.
-- ---------------------------------------------------------------
create table if not exists public.email_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  type        text not null check (type in ('verify', 'reset', 'notice')),
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists email_tokens_user_type_idx on public.email_tokens (user_id, type, created_at desc);

-- ---------------------------------------------------------------
-- Actualiza updated_at automaticamente
-- ---------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------
-- Seguridad: Row Level Security activado y SIN politicas.
-- Nadie puede leer ni escribir con la clave publica (anon/publishable).
-- Solo el servidor, con la clave secreta, accede a estas tablas.
-- ---------------------------------------------------------------
alter table public.users enable row level security;
alter table public.email_tokens enable row level security;

revoke all on public.users from anon, authenticated;
revoke all on public.email_tokens from anon, authenticated;

-- El servidor (clave secreta = rol service_role) necesita acceso explicito, por si el proyecto no lo da por defecto.
grant all on public.users to service_role;
grant all on public.email_tokens to service_role;

-- ---------------------------------------------------------------
-- Mantenimiento opcional (copialo y ejecutalo cuando quieras, o prográmalo con pg_cron):
--
-- Borrar cuentas que nunca confirmaron su correo en 7 dias:
--   delete from public.users where email_verified_at is null and created_at < now() - interval '7 days';
--
-- Borrar tokens vencidos:
--   delete from public.email_tokens where expires_at < now() - interval '1 day';
-- ---------------------------------------------------------------
