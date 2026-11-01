begin;

drop function public.santa_snapshot();
drop function public.santa_remove(uuid);
drop function public.santa_save_draw(uuid[]);

alter table public.santa_event drop constraint santa_event_id_check;
alter table public.santa_event add column year integer not null default 2026 unique check (year between 2020 and 2100);
alter table public.santa_event add column registration_open boolean not null default true;
alter table public.santa_event add column current_version integer check (current_version > 0);
alter table public.santa_event add column revision bigint not null default 0;
update public.santa_event set registration_open = drawn_at is null,
  current_version = case when drawn_at is not null then 1 end;

create table public.santa_settings (
  id smallint primary key check (id = 1),
  active_year integer not null references public.santa_event(year)
);
insert into public.santa_settings values (1, 2026);

create table public.santa_people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  name_key text not null
);

alter table public.santa_participants add column year integer not null default 2026 references public.santa_event(year);
alter table public.santa_participants add column person_id uuid references public.santa_people(id);
alter table public.santa_participants drop constraint santa_participants_idempotency_key_key;
alter table public.santa_participants add unique (year, idempotency_key);
create index santa_participants_year on public.santa_participants(year);
create unique index santa_participants_person_per_year on public.santa_participants(year, person_id) where person_id is not null;

create table public.santa_draws (
  year integer not null references public.santa_event(year),
  version integer not null check (version > 0),
  source text not null check (source in ('manual', 'legacy', 'generated')),
  created_at timestamptz not null default now(),
  drawn_at timestamptz,
  sms_locked_at timestamptz,
  previous_year integer,
  previous_version integer,
  primary key (year, version),
  foreign key (previous_year, previous_version) references public.santa_draws(year, version),
  check ((previous_year is null) = (previous_version is null)),
  check (previous_year is null or previous_year < year)
);

create table public.santa_draw_entries (
  year integer not null,
  version integer not null,
  entry_no integer not null check (entry_no > 0),
  giver_id uuid references public.santa_participants(id),
  receiver_id uuid references public.santa_participants(id),
  giver_person_id uuid references public.santa_people(id),
  receiver_person_id uuid references public.santa_people(id),
  giver_name text not null,
  receiver_name text not null,
  giver_phone text,
  receiver_statements text[] not null default '{}',
  primary key (year, version, entry_no),
  foreign key (year, version) references public.santa_draws(year, version),
  unique (year, version, giver_id),
  unique (year, version, receiver_id),
  unique (year, version, giver_person_id),
  unique (year, version, receiver_person_id),
  check (giver_id is null or receiver_id is null or giver_id <> receiver_id),
  check (giver_person_id is null or receiver_person_id is null or giver_person_id <> receiver_person_id)
);

alter table public.santa_assignments rename to santa_legacy_assignments;
revoke all on public.santa_legacy_assignments from service_role;
grant select on public.santa_legacy_assignments to service_role;

do $$
begin
  if (exists(select 1 from public.santa_legacy_assignments)) <>
    (exists(select 1 from public.santa_event where year = 2026 and drawn_at is not null)) then
    raise exception 'Legacy draw state is inconsistent. Check assignments and drawn_at before migrating.';
  end if;
end;
$$;

insert into public.santa_draws(year, version, source, drawn_at)
  select year, 1, 'legacy', drawn_at from public.santa_event where current_version = 1;
insert into public.santa_draw_entries(year, version, entry_no, giver_id, receiver_id, giver_name, receiver_name, giver_phone, receiver_statements)
  select 2026, 1, row_number() over(order by assignment.giver_id), assignment.giver_id, assignment.receiver_id,
    giver.name, receiver.name, giver.phone, receiver.statements
  from public.santa_legacy_assignments assignment
  join public.santa_participants giver on giver.id = assignment.giver_id
  join public.santa_participants receiver on receiver.id = assignment.receiver_id;

insert into public.santa_event(id, year, registration_open, current_version)
  values (2025, 2025, false, 1);
insert into public.santa_draws(year, version, source) values (2025, 1, 'manual');

alter table public.santa_event add foreign key (year, current_version) references public.santa_draws(year, version);

alter table public.santa_settings enable row level security;
alter table public.santa_people enable row level security;
alter table public.santa_draws enable row level security;
alter table public.santa_draw_entries enable row level security;
revoke all on public.santa_settings, public.santa_people, public.santa_draws, public.santa_draw_entries from public, anon, authenticated;
grant all on public.santa_settings, public.santa_people, public.santa_draws, public.santa_draw_entries to service_role;

create function public.santa_public_event()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('year', event.year, 'registrationOpen', event.registration_open and event.current_version is null)
  from public.santa_settings settings join public.santa_event event on event.year = settings.active_year where settings.id = 1;
$$;

create or replace function public.santa_submit(input_data jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  selected_year integer := (input_data->>'year')::integer;
  active integer;
  existing public.santa_participants;
  saved public.santa_participants;
begin
  select active_year into active from public.santa_settings where id = 1 for update;
  if selected_year is null then raise exception 'SANTA_YEAR_CHANGED'; end if;
  select * into existing from public.santa_participants
    where year = selected_year and idempotency_key = (input_data->>'idempotencyKey')::uuid;
  if found then
    if existing.request_hash <> input_data->>'requestHash' then raise exception 'SANTA_RETRY_CHANGED'; end if;
    return jsonb_build_object('year', existing.year, 'name', existing.name, 'elfTitle', existing.elf_title);
  end if;
  if selected_year <> active then raise exception 'SANTA_YEAR_CHANGED'; end if;
  if not exists(select 1 from public.santa_event where year = selected_year and registration_open and current_version is null) then
    raise exception 'SANTA_CLOSED';
  end if;
  insert into public.santa_participants(year, name, name_key, phone, statements, timing, elf_title, idempotency_key, request_hash)
    values (selected_year, input_data->>'name', input_data->>'nameKey', input_data->>'phone',
      array(select jsonb_array_elements_text(input_data->'statements')), input_data->>'timing', input_data->>'elfTitle',
      (input_data->>'idempotencyKey')::uuid, input_data->>'requestHash') returning * into saved;
  update public.santa_event set revision = revision + 1 where year = selected_year;
  return jsonb_build_object('year', saved.year, 'name', saved.name, 'elfTitle', saved.elf_title);
end;
$$;

create function public.santa_snapshot(input_year integer default null, input_version integer default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  active integer;
  event public.santa_event;
  chosen_version integer;
  prior_version integer;
begin
  select active_year into active from public.santa_settings where id = 1;
  select * into event from public.santa_event where year = coalesce(input_year, active);
  if not found then raise exception 'SANTA_YEAR_NOT_FOUND'; end if;
  chosen_version := coalesce(input_version, event.current_version);
  if chosen_version is not null and not exists(select 1 from public.santa_draws where year = event.year and version = chosen_version) then
    raise exception 'SANTA_VERSION_NOT_FOUND';
  end if;
  select current_version into prior_version from public.santa_event where year = event.year - 1;
  return jsonb_build_object(
    'year', event.year, 'activeYear', active, 'revision', event.revision,
    'registrationOpen', event.registration_open and event.current_version is null,
    'drawnAt', event.drawn_at, 'currentVersion', event.current_version, 'selectedVersion', chosen_version,
    'identityEditable', (event.current_version is null or exists(select 1 from public.santa_draws where year = event.year and version = event.current_version and source = 'legacy'))
      and not exists(select 1 from public.santa_draws where previous_year = event.year),
    'historyReferenced', exists(select 1 from public.santa_draws where previous_year = event.year),
    'years', (select jsonb_agg(jsonb_build_object('year', year, 'currentVersion', current_version, 'registrationOpen', registration_open and current_version is null) order by year desc) from public.santa_event),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'nameKey', name_key) order by name, id) from public.santa_people), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'nameKey', name_key,
      'phone', phone, 'statements', statements, 'timing', timing, 'elfTitle', elf_title,
      'personId', person_id, 'createdAt', created_at) order by created_at, id) from public.santa_participants where year = event.year), '[]'::jsonb),
    'draws', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'source', source, 'createdAt', created_at,
      'drawnAt', drawn_at, 'smsLockedAt', sms_locked_at, 'previousYear', previous_year, 'previousVersion', previous_version) order by version desc)
      from public.santa_draws where year = event.year), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('giver_id', entry.giver_id, 'receiver_id', entry.receiver_id,
      'giverPersonId', coalesce(entry.giver_person_id, giver.person_id), 'receiverPersonId', coalesce(entry.receiver_person_id, receiver.person_id),
      'giverName', entry.giver_name, 'receiverName', entry.receiver_name, 'giverPhone', entry.giver_phone, 'receiverStatements', entry.receiver_statements) order by entry.entry_no)
      from public.santa_draw_entries entry left join public.santa_participants giver on giver.id = entry.giver_id
      left join public.santa_participants receiver on receiver.id = entry.receiver_id
      where entry.year = event.year and entry.version = chosen_version), '[]'::jsonb),
    'previousDraw', case when prior_version is null then null else jsonb_build_object('year', event.year - 1, 'version', prior_version,
      'pairs', coalesce((select jsonb_agg(jsonb_build_object('giverPersonId', coalesce(entry.giver_person_id, giver.person_id),
        'receiverPersonId', coalesce(entry.receiver_person_id, receiver.person_id), 'giverName', entry.giver_name, 'receiverName', entry.receiver_name))
        from public.santa_draw_entries entry left join public.santa_participants giver on giver.id = entry.giver_id
        left join public.santa_participants receiver on receiver.id = entry.receiver_id
        where entry.year = event.year - 1 and entry.version = prior_version), '[]'::jsonb)) end
  );
end;
$$;

create function public.santa_create_year(input_year integer)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.santa_settings where id = 1 for update;
  if input_year is null or input_year not between 2020 and 2100 then raise exception 'SANTA_INVALID_YEAR'; end if;
  if exists(select 1 from public.santa_event where year = input_year) then raise exception 'SANTA_YEAR_EXISTS'; end if;
  insert into public.santa_event(id, year) values (input_year, input_year);
end;
$$;

create function public.santa_activate_year(input_year integer, input_expected_active integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  active integer;
begin
  select active_year into active from public.santa_settings where id = 1 for update;
  if active is distinct from input_expected_active then raise exception 'SANTA_CHANGED'; end if;
  if not exists(select 1 from public.santa_event where year = input_year) then raise exception 'SANTA_YEAR_NOT_FOUND'; end if;
  update public.santa_settings set active_year = input_year where id = 1;
end;
$$;

create function public.santa_remove(input_id uuid, input_year integer, input_revision bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  event public.santa_event;
begin
  perform 1 from public.santa_settings where id = 1 for update;
  select * into event from public.santa_event where year = input_year;
  if not found then raise exception 'SANTA_YEAR_NOT_FOUND'; end if;
  if event.revision is distinct from input_revision then raise exception 'SANTA_CHANGED'; end if;
  if event.current_version is not null then raise exception 'SANTA_CLOSED'; end if;
  delete from public.santa_participants where id = input_id and year = input_year;
  if not found then raise exception 'SANTA_NOT_FOUND'; end if;
  update public.santa_event set revision = revision + 1 where year = input_year;
end;
$$;

create function public.santa_set_person(input_year integer, input_id uuid, input_person_id uuid, input_revision bigint, input_create_person boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  event public.santa_event;
  participant public.santa_participants;
  person uuid := input_person_id;
begin
  perform 1 from public.santa_settings where id = 1 for update;
  select * into event from public.santa_event where year = input_year;
  if not found then raise exception 'SANTA_YEAR_NOT_FOUND'; end if;
  if event.revision is distinct from input_revision then raise exception 'SANTA_CHANGED'; end if;
  if exists(select 1 from public.santa_draws where previous_year = input_year) then raise exception 'SANTA_HISTORY_REFERENCED'; end if;
  if event.current_version is not null and not exists(select 1 from public.santa_draws where year = input_year and version = event.current_version and source = 'legacy') then
    raise exception 'SANTA_IDENTITY_LOCKED';
  end if;
  select * into participant from public.santa_participants where id = input_id and year = input_year;
  if not found then raise exception 'SANTA_NOT_FOUND'; end if;
  if input_create_person then
    if person is not null then raise exception 'SANTA_INVALID_PERSON'; end if;
    insert into public.santa_people(name, name_key) values (participant.name, participant.name_key) returning id into person;
  elsif person is not null and not exists(select 1 from public.santa_people where id = person) then
    raise exception 'SANTA_INVALID_PERSON';
  end if;
  if person is not null and exists(select 1 from public.santa_participants where year = input_year and person_id = person and id <> input_id) then
    raise exception 'SANTA_DUPLICATE_PERSON';
  end if;
  update public.santa_participants set person_id = person where id = input_id;
  update public.santa_event set revision = revision + 1 where year = input_year;
end;
$$;

create function public.santa_save_draw(input_year integer, input_ids uuid[], input_revision bigint,
  input_expected_version integer, input_previous_version integer, input_confirm_unsent boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  event public.santa_event;
  prior_version integer;
  participant_count integer;
  distinct_count integer;
  new_version integer;
begin
  perform 1 from public.santa_settings where id = 1 for update;
  select * into event from public.santa_event where year = input_year;
  if not found then raise exception 'SANTA_YEAR_NOT_FOUND'; end if;
  if event.revision is distinct from input_revision or coalesce(event.current_version, 0) is distinct from input_expected_version then
    raise exception 'SANTA_CHANGED';
  end if;
  if exists(select 1 from public.santa_draws where year = input_year and source = 'manual') then raise exception 'SANTA_HISTORY_ONLY'; end if;
  if exists(select 1 from public.santa_draws where year = input_year and sms_locked_at is not null) then raise exception 'SANTA_SMS_LOCKED'; end if;
  if exists(select 1 from public.santa_draws where previous_year = input_year) then raise exception 'SANTA_HISTORY_REFERENCED'; end if;
  if event.current_version is not null and input_confirm_unsent is distinct from true then raise exception 'SANTA_SMS_CONFIRM'; end if;
  select count(*) into participant_count from public.santa_participants where year = input_year;
  if participant_count < 3 then raise exception 'SANTA_MINIMUM'; end if;
  select count(distinct participant_id) into distinct_count from unnest(input_ids) as participant_id;
  if array_ndims(input_ids) is distinct from 1 or array_lower(input_ids, 1) is distinct from 1
    or cardinality(input_ids) is distinct from participant_count or distinct_count <> participant_count
    or exists(select 1 from unnest(input_ids) as participant_id where participant_id is null
      or not exists(select 1 from public.santa_participants where id = participant_id and year = input_year)) then
    raise exception 'SANTA_CHANGED';
  end if;
  if exists(select 1 from public.santa_participants where year = input_year and person_id is null) then raise exception 'SANTA_IDENTITY_REQUIRED'; end if;
  select current_version into prior_version from public.santa_event where year = input_year - 1;
  if coalesce(prior_version, 0) is distinct from input_previous_version then raise exception 'SANTA_CHANGED'; end if;
  if prior_version is not null and (select count(*) from public.santa_draw_entries where year = input_year - 1 and version = prior_version) < 3 then
    raise exception 'SANTA_HISTORY_MISSING';
  end if;
  if prior_version is not null and exists(
    select 1 from public.santa_draw_entries old
    left join public.santa_participants giver on giver.id = old.giver_id
    left join public.santa_participants receiver on receiver.id = old.receiver_id
    where old.year = input_year - 1 and old.version = prior_version
      and (coalesce(old.giver_person_id, giver.person_id) is null or coalesce(old.receiver_person_id, receiver.person_id) is null)
  ) then raise exception 'SANTA_HISTORY_UNMAPPED'; end if;
  if prior_version is not null and exists(
    select 1 from generate_series(1, participant_count) as position
    join public.santa_participants giver on giver.id = input_ids[position]
    join public.santa_participants receiver on receiver.id = input_ids[(position % participant_count) + 1]
    join public.santa_draw_entries old on old.year = input_year - 1 and old.version = prior_version
    left join public.santa_participants old_giver on old_giver.id = old.giver_id
    left join public.santa_participants old_receiver on old_receiver.id = old.receiver_id
    where giver.person_id = coalesce(old.giver_person_id, old_giver.person_id)
      and receiver.person_id = coalesce(old.receiver_person_id, old_receiver.person_id)
  ) then raise exception 'SANTA_REPEAT'; end if;
  if event.current_version is not null and not exists(
    select 1 from generate_series(1, participant_count) as position
    where not exists(select 1 from public.santa_draw_entries old where old.year = input_year and old.version = event.current_version
      and old.giver_id = input_ids[position] and old.receiver_id = input_ids[(position % participant_count) + 1])
  ) then raise exception 'SANTA_SAME_DRAW'; end if;
  new_version := coalesce(event.current_version, 0) + 1;
  insert into public.santa_draws(year, version, source, drawn_at, previous_year, previous_version)
    values (input_year, new_version, 'generated', now(), case when prior_version is not null then input_year - 1 end, prior_version);
  insert into public.santa_draw_entries(year, version, entry_no, giver_id, receiver_id, giver_person_id, receiver_person_id,
    giver_name, receiver_name, giver_phone, receiver_statements)
    select input_year, new_version, position, giver.id, receiver.id, giver.person_id, receiver.person_id,
      giver.name, receiver.name, giver.phone, receiver.statements
    from generate_series(1, participant_count) as position
    join public.santa_participants giver on giver.id = input_ids[position]
    join public.santa_participants receiver on receiver.id = input_ids[(position % participant_count) + 1];
  update public.santa_event set current_version = new_version, drawn_at = now(), registration_open = false, revision = revision + 1
    where year = input_year;
end;
$$;

create function public.santa_lock_draw(input_year integer, input_version integer, input_revision bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  event public.santa_event;
begin
  perform 1 from public.santa_settings where id = 1 for update;
  select * into event from public.santa_event where year = input_year;
  if not found then raise exception 'SANTA_YEAR_NOT_FOUND'; end if;
  if event.revision is distinct from input_revision or event.current_version is distinct from input_version then raise exception 'SANTA_CHANGED'; end if;
  if input_version is null then raise exception 'SANTA_VERSION_NOT_FOUND'; end if;
  update public.santa_draws set sms_locked_at = coalesce(sms_locked_at, now()) where year = input_year and version = input_version;
  update public.santa_event set revision = revision + 1 where year = input_year;
end;
$$;

revoke all on function public.santa_public_event(), public.santa_submit(jsonb), public.santa_snapshot(integer,integer),
  public.santa_create_year(integer), public.santa_activate_year(integer,integer), public.santa_remove(uuid,integer,bigint),
  public.santa_set_person(integer,uuid,uuid,bigint,boolean), public.santa_save_draw(integer,uuid[],bigint,integer,integer,boolean),
  public.santa_lock_draw(integer,integer,bigint) from public, anon, authenticated;
grant execute on function public.santa_public_event(), public.santa_submit(jsonb), public.santa_snapshot(integer,integer),
  public.santa_create_year(integer), public.santa_activate_year(integer,integer), public.santa_remove(uuid,integer,bigint),
  public.santa_set_person(integer,uuid,uuid,bigint,boolean), public.santa_save_draw(integer,uuid[],bigint,integer,integer,boolean),
  public.santa_lock_draw(integer,integer,bigint) to service_role;

commit;
