-- Supabase SQL schema for CalcChat

-- Enable pgcrypto for bcrypt hashing
create extension if not exists pgcrypto;

-- Profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  username text not null,
  avatar_url text,
  passcode_hash text,
  is_online boolean not null default false,
  last_active timestamptz not null default now(),
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

-- Create profile row on auth.users insert
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles(id, email, username)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 6)))
  on conflict (id) do nothing;
  return new;
end; $$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

-- RLS policies
-- Users can view limited public fields via a SECURITY DEFINER function; restrict direct select by default
drop policy if exists "allow_self_update" on public.profiles;
create policy "allow_self_update" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- Allow a user to read their own profile (needed by client to fetch current profile)
drop policy if exists "allow_self_select" on public.profiles;
create policy "allow_self_select" on public.profiles
  for select using (auth.uid() = id);

-- Allow insert for service/trigger and self (sign-up race), but typical inserts happen via trigger or client.
drop policy if exists "allow_self_insert" on public.profiles;
create policy "allow_self_insert" on public.profiles
  for insert with check (auth.uid() = id);

-- Messages table
create table if not exists public.messages (
  id bigserial primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('text','tiktok','image','deleted')),
  content text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  seen_at timestamptz
);

alter table public.messages enable row level security;
-- In case table existed before columns were added
alter table public.messages add column if not exists delivered_at timestamptz;
alter table public.messages add column if not exists seen_at timestamptz;
alter table public.messages add column if not exists updated_at timestamptz;
-- Reply support
alter table public.messages add column if not exists reply_to_id bigint references public.messages(id) on delete set null;
create index if not exists idx_messages_reply_to on public.messages(reply_to_id);

-- Keep messages.updated_at fresh on updates
create or replace function public.touch_messages_updated_at()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists trg_messages_updated_at on public.messages;
create trigger trg_messages_updated_at before update on public.messages
for each row execute function public.touch_messages_updated_at();

drop policy if exists "read_own_dms" on public.messages;
create policy "read_own_dms" on public.messages
  for select using (
    auth.uid() = sender_id or auth.uid() = receiver_id
  );

drop policy if exists "send_messages" on public.messages;
create policy "send_messages" on public.messages
  for insert with check (
    auth.uid() = sender_id
  );

-- Allow the sender to update their own messages (for edit/delete)
drop policy if exists "sender_update_own" on public.messages;
create policy "sender_update_own" on public.messages
  for update using (auth.uid() = sender_id)
  with check (auth.uid() = sender_id);

-- Allow the receiver to update delivery/seen timestamps
drop policy if exists "receiver_updates_status" on public.messages;
create policy "receiver_updates_status" on public.messages
  for update using (auth.uid() = receiver_id)
  with check (auth.uid() = receiver_id);

-- RPC: set_passcode with bcrypt
create or replace function public.set_passcode(passcode text)
returns void as $$
begin
  update public.profiles
    set passcode_hash = crypt(passcode, gen_salt('bf')),
        updated_at = now()
  where id = auth.uid();
end; $$ language plpgsql security definer;

grant execute on function public.set_passcode(text) to authenticated;

-- RPC: verify_passcode
create or replace function public.verify_passcode(passcode text)
returns boolean as $$
declare ok boolean;
begin
  select (passcode_hash is not null and passcode_hash = crypt(passcode, passcode_hash)) into ok
  from public.profiles where id = auth.uid();
  return coalesce(ok, false);
end; $$ language plpgsql security definer;

grant execute on function public.verify_passcode(text) to authenticated;

-- RPC: get_public_profiles (only safe fields)
create or replace function public.get_public_profiles()
returns table (
  id uuid,
  username text,
  avatar_url text,
  is_online boolean,
  last_active timestamptz
) as $$
  select p.id, p.username, p.avatar_url, p.is_online, p.last_active
  from public.profiles p;
$$ language sql security definer;

grant execute on function public.get_public_profiles() to anon, authenticated;

-- Realtime: ensure replication is enabled for these tables in Supabase dashboard (typically default)
