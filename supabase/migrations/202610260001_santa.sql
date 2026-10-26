begin;

create table public.santa_event (
  id smallint primary key check (id = 1),
  drawn_at timestamptz
);
insert into public.santa_event (id) values (1);

create table public.santa_participants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  name_key text not null,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  statements text[] not null check (
    cardinality(statements) between 1 and 3 and
    statements <@ array['lights','cookies','fairytales','cozy','family','snow','wrapping','music','food']::text[]
  ),
  timing text not null check (timing in ('early','gradual','last-minute')),
  elf_title text not null,
  idempotency_key uuid not null unique,
  request_hash text not null,
  created_at timestamptz not null default now()
);
create index santa_participants_name_key on public.santa_participants (name_key);
create index santa_participants_phone on public.santa_participants (phone);

create table public.santa_assignments (
  giver_id uuid primary key references public.santa_participants(id) on delete restrict,
  receiver_id uuid not null unique references public.santa_participants(id) on delete restrict,
  check (giver_id <> receiver_id)
);

create table public.santa_rate_limits (
  client_key text not null,
  scope text not null,
  bucket timestamptz not null,
  attempts integer not null default 1,
  primary key (client_key, scope, bucket)
);

alter table public.santa_event enable row level security;
alter table public.santa_participants enable row level security;
alter table public.santa_assignments enable row level security;
alter table public.santa_rate_limits enable row level security;
revoke all on public.santa_event, public.santa_participants, public.santa_assignments, public.santa_rate_limits from public, anon, authenticated;
grant all on public.santa_event, public.santa_participants, public.santa_assignments, public.santa_rate_limits to service_role;

create function public.santa_rate_limit(input_key text, input_scope text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  current_bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / 900) * 900);
  attempt_count integer;
  allowed_count integer;
begin
  allowed_count := case input_scope when 'submit' then 20 when 'login' then 10 when 'admin' then 300 else 0 end;
  delete from public.santa_rate_limits where bucket < now() - interval '1 day';
  insert into public.santa_rate_limits (client_key, scope, bucket)
    values (input_key, input_scope, current_bucket)
    on conflict (client_key, scope, bucket) do update
      set attempts = public.santa_rate_limits.attempts + 1
    returning attempts into attempt_count;
  return attempt_count <= allowed_count;
end;
$$;

create function public.santa_submit(input_data jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  existing public.santa_participants;
  saved public.santa_participants;
begin
  perform 1 from public.santa_event where id = 1 for update;
  select * into existing from public.santa_participants where idempotency_key = (input_data->>'idempotencyKey')::uuid;
  if found then
    if existing.request_hash <> input_data->>'requestHash' then raise exception 'SANTA_RETRY_CHANGED'; end if;
    return jsonb_build_object('name', existing.name, 'elfTitle', existing.elf_title);
  end if;
  if (select drawn_at is not null from public.santa_event where id = 1) then raise exception 'SANTA_CLOSED'; end if;
  insert into public.santa_participants (name, name_key, phone, statements, timing, elf_title, idempotency_key, request_hash)
    values (
      input_data->>'name', input_data->>'nameKey', input_data->>'phone',
      array(select jsonb_array_elements_text(input_data->'statements')),
      input_data->>'timing', input_data->>'elfTitle',
      (input_data->>'idempotencyKey')::uuid, input_data->>'requestHash'
    ) returning * into saved;
  return jsonb_build_object('name', saved.name, 'elfTitle', saved.elf_title);
end;
$$;

create function public.santa_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'drawnAt', (select drawn_at from public.santa_event where id = 1),
    'participants', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'nameKey', name_key, 'phone', phone,
      'statements', statements, 'timing', timing, 'elfTitle', elf_title, 'createdAt', created_at
    ) order by created_at, id) from public.santa_participants), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object(
      'giver_id', giver_id, 'receiver_id', receiver_id
    ) order by giver_id) from public.santa_assignments), '[]'::jsonb)
  );
$$;

create function public.santa_remove(input_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.santa_event where id = 1 for update;
  if (select drawn_at is not null from public.santa_event where id = 1) then raise exception 'SANTA_CLOSED'; end if;
  delete from public.santa_participants where id = input_id;
  if not found then raise exception 'SANTA_NOT_FOUND'; end if;
end;
$$;

create function public.santa_save_draw(input_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare
  participant_count integer;
  distinct_count integer;
begin
  perform 1 from public.santa_event where id = 1 for update;
  if (select drawn_at is not null from public.santa_event where id = 1) then raise exception 'SANTA_CLOSED'; end if;
  select count(*) into participant_count from public.santa_participants;
  if participant_count < 3 then raise exception 'SANTA_MINIMUM'; end if;
  select count(distinct participant_id) into distinct_count from unnest(input_ids) as participant_id;
  if cardinality(input_ids) is distinct from participant_count or distinct_count <> participant_count
    or exists (select 1 from unnest(input_ids) as participant_id where participant_id is null
      or not exists (select 1 from public.santa_participants where id = participant_id)) then
    raise exception 'SANTA_CHANGED';
  end if;
  insert into public.santa_assignments (giver_id, receiver_id)
    select input_ids[position], input_ids[(position % participant_count) + 1]
    from generate_series(1, participant_count) as position;
  update public.santa_event set drawn_at = now() where id = 1;
end;
$$;

revoke all on function public.santa_rate_limit(text,text), public.santa_submit(jsonb), public.santa_snapshot(), public.santa_remove(uuid), public.santa_save_draw(uuid[]) from public, anon, authenticated;
grant execute on function public.santa_rate_limit(text,text), public.santa_submit(jsonb), public.santa_snapshot(), public.santa_remove(uuid), public.santa_save_draw(uuid[]) to service_role;

commit;
