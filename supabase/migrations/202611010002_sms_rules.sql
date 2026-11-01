begin;

-- Apply after 202611010001_seasons_and_versions.sql. Existing draws are unchanged.
alter table public.santa_event add column sms_rules text not null default ''
  check (char_length(sms_rules) <= 2000);
update public.santa_event
  set sms_rules = 'Připrav 2–3 dárky v celkové hodnotě nejvýše 3 000 Kč.'
  where year = 2026;

create or replace function public.santa_snapshot(input_year integer default null, input_version integer default null)
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
    'year', event.year, 'activeYear', active, 'revision', event.revision, 'rules', event.sms_rules,
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
      'giverName', entry.giver_name, 'giverElfTitle', giver.elf_title, 'receiverName', entry.receiver_name, 'giverPhone', entry.giver_phone, 'receiverStatements', entry.receiver_statements) order by entry.entry_no)
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

create function public.santa_set_rules(input_year integer, input_rules text, input_revision bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  event public.santa_event;
begin
  perform 1 from public.santa_settings where id = 1 for update;
  select * into event from public.santa_event where year = input_year;
  if not found then raise exception 'SANTA_YEAR_NOT_FOUND'; end if;
  if event.revision is distinct from input_revision then raise exception 'SANTA_CHANGED'; end if;
  if exists(select 1 from public.santa_draws where year = input_year and source = 'manual') then
    raise exception 'SANTA_HISTORY_ONLY';
  end if;
  if input_rules is null or char_length(input_rules) > 2000
    or translate(input_rules, chr(9) || chr(10) || chr(13), '') ~ '[[:cntrl:]]' then
    raise exception 'SANTA_INVALID_RULES';
  end if;
  update public.santa_event
    set sms_rules = btrim(replace(replace(input_rules, E'\r\n', E'\n'), E'\r', E'\n')),
      revision = revision + 1
    where year = input_year;
end;
$$;

revoke all on function public.santa_set_rules(integer,text,bigint) from public, anon, authenticated;
grant execute on function public.santa_set_rules(integer,text,bigint) to service_role;
revoke all on function public.santa_snapshot(integer,integer) from public, anon, authenticated;
grant execute on function public.santa_snapshot(integer,integer) to service_role;

commit;
