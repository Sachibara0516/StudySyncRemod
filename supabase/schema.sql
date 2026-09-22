-- StudySyncRemod Supabase bootstrap
-- Run with an owner/admin role on a dedicated Supabase project.
-- Designed for Supabase Auth + Data API + Storage + Realtime.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  institution_id text unique,
  role text not null default 'student' check (role in ('student','professor')),
  display_name text not null default '',
  email_notifications boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  due_date date,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  note_key text not null check (char_length(note_key) between 1 and 300),
  content text not null default '',
  updated_at timestamptz not null default now(),
  unique(owner_id, note_key)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  assignment_key text not null check (char_length(assignment_key) between 1 and 300),
  file_name text not null,
  storage_path text not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, assignment_key)
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(created_by, name)
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  institution_id text not null,
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  primary key(group_id, user_id)
);

create table if not exists public.group_files (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete restrict,
  file_name text not null,
  storage_path text not null unique,
  uploaded_at timestamptz not null default now()
);

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  sender_label text not null default 'User',
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists profiles_institution_id_idx on public.profiles(institution_id);
create index if not exists tasks_owner_due_idx on public.tasks(owner_id, due_date);
create index if not exists notes_owner_idx on public.notes(owner_id);
create index if not exists assignments_owner_idx on public.assignments(owner_id);
create index if not exists groups_created_by_idx on public.groups(created_by);
create index if not exists group_members_user_idx on public.group_members(user_id, group_id);
create index if not exists group_files_group_idx on public.group_files(group_id, uploaded_at);
create index if not exists group_messages_group_created_idx on public.group_messages(group_id, created_at);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function private.set_updated_at();

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at before update on public.notes
for each row execute function private.set_updated_at();

drop trigger if exists assignments_set_updated_at on public.assignments;
create trigger assignments_set_updated_at before update on public.assignments
for each row execute function private.set_updated_at();

create or replace function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.created_by = (select auth.uid())
  )
  or exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
      and gm.role = 'admin'
  );
$$;

revoke all on function private.is_group_member(uuid) from public, anon;
revoke all on function private.is_group_admin(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_group_member(uuid) to authenticated;
grant execute on function private.is_group_admin(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;
alter table public.assignments enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_files enable row level security;
alter table public.group_messages enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists tasks_owner_all on public.tasks;
create policy tasks_owner_all on public.tasks
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists notes_owner_all on public.notes;
create policy notes_owner_all on public.notes
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists assignments_owner_all on public.assignments;
create policy assignments_owner_all on public.assignments
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists groups_select_members on public.groups;
create policy groups_select_members on public.groups
for select to authenticated
using (
  created_by = (select auth.uid())
  or (select private.is_group_member(id))
);

drop policy if exists groups_insert_owner on public.groups;
create policy groups_insert_owner on public.groups
for insert to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists groups_update_owner on public.groups;
create policy groups_update_owner on public.groups
for update to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

drop policy if exists groups_delete_owner on public.groups;
create policy groups_delete_owner on public.groups
for delete to authenticated
using (created_by = (select auth.uid()));

drop policy if exists group_members_select_members on public.group_members;
create policy group_members_select_members on public.group_members
for select to authenticated
using ((select private.is_group_member(group_id)));

drop policy if exists group_members_insert_creator on public.group_members;
create policy group_members_insert_creator on public.group_members
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.groups g
    where g.id = group_id
      and g.created_by = (select auth.uid())
  )
);

drop policy if exists group_members_delete_self_or_admin on public.group_members;
create policy group_members_delete_self_or_admin on public.group_members
for delete to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_group_admin(group_id))
);

drop policy if exists group_files_select_members on public.group_files;
create policy group_files_select_members on public.group_files
for select to authenticated
using ((select private.is_group_member(group_id)));

drop policy if exists group_files_insert_members on public.group_files;
create policy group_files_insert_members on public.group_files
for insert to authenticated
with check (
  uploader_id = (select auth.uid())
  and (select private.is_group_member(group_id))
);

drop policy if exists group_files_delete_uploader_or_admin on public.group_files;
create policy group_files_delete_uploader_or_admin on public.group_files
for delete to authenticated
using (
  uploader_id = (select auth.uid())
  or (select private.is_group_admin(group_id))
);

drop policy if exists group_messages_select_members on public.group_messages;
create policy group_messages_select_members on public.group_messages
for select to authenticated
using ((select private.is_group_member(group_id)));

drop policy if exists group_messages_insert_members on public.group_messages;
create policy group_messages_insert_members on public.group_messages
for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and (select private.is_group_member(group_id))
);

drop policy if exists group_messages_delete_sender on public.group_messages;
create policy group_messages_delete_sender on public.group_messages
for delete to authenticated
using (sender_id = (select auth.uid()));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update(display_name, email_notifications, updated_at) on public.profiles to authenticated;

revoke all on public.tasks from anon, authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

revoke all on public.notes from anon, authenticated;
grant select, insert, update, delete on public.notes to authenticated;

revoke all on public.assignments from anon, authenticated;
grant select, insert, update, delete on public.assignments to authenticated;

revoke all on public.groups from anon, authenticated;
grant select, insert, update, delete on public.groups to authenticated;

revoke all on public.group_members from anon, authenticated;
grant select, insert, delete on public.group_members to authenticated;

revoke all on public.group_files from anon, authenticated;
grant select, insert, delete on public.group_files to authenticated;

revoke all on public.group_messages from anon, authenticated;
grant select, insert, delete on public.group_messages to authenticated;

create or replace function public.create_study_group(p_name text)
returns table(id uuid, name text, created_by uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group public.groups;
  v_institution_id text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if char_length(trim(p_name)) < 1 or char_length(trim(p_name)) > 120 then
    raise exception 'Group name must be between 1 and 120 characters';
  end if;

  select p.institution_id
    into v_institution_id
  from public.profiles p
  where p.id = (select auth.uid());

  if v_institution_id is null then
    raise exception 'Account profile requires an institution ID';
  end if;

  insert into public.groups(name, created_by)
  values (trim(p_name), (select auth.uid()))
  returning * into v_group;

  insert into public.group_members(group_id, user_id, institution_id, role)
  values (v_group.id, (select auth.uid()), v_institution_id, 'admin');

  return query
  select v_group.id, v_group.name, v_group.created_by;
end;
$$;

create or replace function public.invite_group_member(
  p_group_id uuid,
  p_institution_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_target public.profiles;
begin
  if v_caller is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.created_by = v_caller
  ) and not exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = v_caller
      and gm.role = 'admin'
  ) then
    raise exception 'Only a group administrator can invite members';
  end if;

  select *
    into v_target
  from public.profiles p
  where p.institution_id = trim(p_institution_id)
    and p.role = 'student'
  limit 1;

  if v_target.id is null then
    raise exception 'Student not found';
  end if;

  insert into public.group_members(group_id, user_id, institution_id, role)
  values (p_group_id, v_target.id, v_target.institution_id, 'member')
  on conflict (group_id, user_id) do nothing;

  return jsonb_build_object(
    'user_id', v_target.id,
    'institution_id', v_target.institution_id,
    'display_name', v_target.display_name
  );
end;
$$;

revoke all on function public.create_study_group(text) from public, anon;
revoke all on function public.invite_group_member(uuid, text) from public, anon;
grant execute on function public.create_study_group(text) to authenticated;
grant execute on function public.invite_group_member(uuid, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('assignments', 'assignments', false, 20971520),
  ('group-files', 'group-files', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists assignments_objects_select_own on storage.objects;
create policy assignments_objects_select_own on storage.objects
for select to authenticated
using (
  bucket_id = 'assignments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists assignments_objects_insert_own on storage.objects;
create policy assignments_objects_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'assignments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists assignments_objects_delete_own on storage.objects;
create policy assignments_objects_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id = 'assignments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists group_files_objects_select_members on storage.objects;
create policy group_files_objects_select_members on storage.objects
for select to authenticated
using (
  bucket_id = 'group-files'
  and (select private.is_group_member(((storage.foldername(name))[1])::uuid))
);

drop policy if exists group_files_objects_insert_self on storage.objects;
create policy group_files_objects_insert_self on storage.objects
for insert to authenticated
with check (
  bucket_id = 'group-files'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (select private.is_group_member(((storage.foldername(name))[1])::uuid))
);

drop policy if exists group_files_objects_delete_self_or_admin on storage.objects;
drop policy if exists group_files_objects_delete_self on storage.objects;
create policy group_files_objects_delete_self_or_admin on storage.objects
for delete to authenticated
using (
  bucket_id = 'group-files'
  and (
    (storage.foldername(name))[2] = (select auth.uid())::text
    or (select private.is_group_admin(((storage.foldername(name))[1])::uuid))
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_messages'
  ) then
    alter publication supabase_realtime add table public.group_messages;
  end if;
end;
$$;
