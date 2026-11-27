-- Archive Quest: общий отряд, ранги, аватарки и местоположение.
-- Вставь весь файл в Supabase → SQL Editor → New query → Run. Повторный запуск безопасен.

-- ---------- таблицы ----------
create table if not exists public.squads (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'ОТРЯД',
  owner uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 24),
  avatar text check (avatar is null or char_length(avatar) <= 120000),
  xp integer not null default 0 check (xp >= 0),
  granted_rank text check (granted_rank in ('r3','r2','r1','fc','as','sc')),
  is_founder boolean not null default false,
  squad_id uuid references public.squads(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  from_id uuid not null references auth.users(id) on delete cascade,
  to_id uuid not null references auth.users(id) on delete cascade,
  rank text not null check (rank in ('r3','r2','r1','fc','as','sc')),
  reason text check (char_length(reason) <= 80),
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  squad_id uuid not null references public.squads(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy real,
  updated_at timestamptz not null default now()
);

-- только один основатель на весь мир
create unique index if not exists one_founder on public.profiles ((true)) where is_founder;

-- ---------- профиль создаётся при регистрации ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- профили для аккаунтов, созданных до запуска этой схемы
insert into public.profiles (id) select id from auth.users on conflict do nothing;

-- создать свой профиль, если его нет (вызывает приложение)
create or replace function public.ensure_profile() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into profiles (id) values (auth.uid()) on conflict do nothing;
end $$;

-- мой отряд (для правил доступа)
create or replace function public.my_squad() returns uuid
language sql stable security definer set search_path = public as $$
  select squad_id from public.profiles where id = auth.uid()
$$;

-- ---------- правила доступа (RLS) ----------
alter table public.squads enable row level security;
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.locations enable row level security;

drop policy if exists "squad: свой отряд" on public.squads;
create policy "squad: свой отряд" on public.squads for select to authenticated
  using (id = public.my_squad());

drop policy if exists "profiles: я и мой отряд" on public.profiles;
create policy "profiles: я и мой отряд" on public.profiles for select to authenticated
  using (id = auth.uid() or (squad_id is not null and squad_id = public.my_squad()));

drop policy if exists "profiles: правлю только себя" on public.profiles;
create policy "profiles: правлю только себя" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- менять можно только имя, аватар и XP; ранг, основателя и отряд — только через функции ниже
revoke update on public.profiles from authenticated, anon;
grant update (name, avatar, xp, updated_at) on public.profiles to authenticated;

drop policy if exists "orders: мой отряд" on public.orders;
create policy "orders: мой отряд" on public.orders for select to authenticated
  using (squad_id = public.my_squad());

drop policy if exists "locations: видит отряд" on public.locations;
create policy "locations: видит отряд" on public.locations for select to authenticated
  using (squad_id = public.my_squad());
drop policy if exists "locations: пишу только своё" on public.locations;
create policy "locations: пишу только своё" on public.locations for insert to authenticated
  with check (user_id = auth.uid() and squad_id = public.my_squad());
drop policy if exists "locations: обновляю только своё" on public.locations;
create policy "locations: обновляю только своё" on public.locations for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and squad_id = public.my_squad());
drop policy if exists "locations: удаляю только своё" on public.locations;
create policy "locations: удаляю только своё" on public.locations for delete to authenticated
  using (user_id = auth.uid());

-- ---------- действия ----------
-- Стать основателем: сработает только у первого, кто нажмёт. Создаёт отряд.
create or replace function public.claim_founder(squad_name text default 'ОТРЯД') returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from profiles where is_founder) then raise exception 'founder already exists'; end if;
  insert into squads (name, owner) values (coalesce(nullif(trim(squad_name), ''), 'ОТРЯД'), auth.uid()) returning id into sid;
  update profiles set is_founder = true, squad_id = sid, updated_at = now() where id = auth.uid();
  return sid;
end $$;

-- Есть ли уже основатель (чтобы прятать кнопку)
create or replace function public.founder_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where is_founder)
$$;

-- Вступить в отряд по коду приглашения
create or replace function public.join_squad(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into sid from squads where invite_code = upper(trim(code));
  if sid is null then raise exception 'bad invite code'; end if;
  update profiles set squad_id = sid, updated_at = now() where id = auth.uid() and not is_founder;
  return sid;
end $$;

-- Выйти из отряда (основатель выйти не может)
create or replace function public.leave_squad() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from locations where user_id = auth.uid();
  update profiles set squad_id = null, updated_at = now() where id = auth.uid() and not is_founder;
end $$;

-- Приказ: только основатель, только своему отряду, максимум Special Class
create or replace function public.grant_rank(target uuid, new_rank text, why text default null) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select squad_id into sid from profiles where id = auth.uid() and is_founder;
  if sid is null then raise exception 'only founder can grant ranks'; end if;
  if new_rank not in ('r3','r2','r1','fc','as','sc') then raise exception 'bad rank'; end if;
  if not exists (select 1 from profiles where id = target and squad_id = sid) then raise exception 'not in your squad'; end if;
  update profiles set granted_rank = new_rank, updated_at = now() where id = target;
  insert into orders (squad_id, from_id, to_id, rank, reason) values (sid, auth.uid(), target, new_rank, left(why, 80));
end $$;

-- Исключить из отряда (основатель)
create or replace function public.kick_member(target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select squad_id into sid from profiles where id = auth.uid() and is_founder;
  if sid is null then raise exception 'only founder'; end if;
  delete from locations where user_id = target and squad_id = sid;
  update profiles set squad_id = null, granted_rank = null where id = target and squad_id = sid and not is_founder;
end $$;

grant execute on function public.claim_founder(text), public.founder_exists(), public.ensure_profile(), public.join_squad(text),
  public.leave_squad(), public.grant_rank(uuid, text, text), public.kick_member(uuid) to authenticated;
revoke execute on function public.claim_founder(text), public.ensure_profile(), public.join_squad(text), public.leave_squad(),
  public.grant_rank(uuid, text, text), public.kick_member(uuid) from anon, public;
