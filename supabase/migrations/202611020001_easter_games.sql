begin;

create table public.santa_games (
  id uuid primary key default gen_random_uuid(),
  year integer not null references public.santa_event(year),
  kind text not null check (kind in ('story','image')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 16000),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 3),
  solutions jsonb not null check (jsonb_typeof(solutions) = 'array'),
  image_data text check (char_length(image_data) <= 700000),
  reveal_text text not null default '' check (char_length(reveal_text) <= 4000),
  starts_at timestamptz not null,
  published boolean not null default false,
  revision bigint not null default 1,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index santa_games_start_unique on public.santa_games(year,starts_at) where published;
create table public.santa_game_results (
  game_id uuid not null references public.santa_games(id),
  participant_id uuid not null references public.santa_participants(id),
  participant_name text not null,
  attempts integer not null check (attempts > 0),
  best_correct integer not null check (best_correct between 0 and 3),
  solved boolean not null default false,
  answers jsonb not null,
  solved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (game_id,participant_id)
);
create table public.santa_game_attempts (
  game_id uuid not null references public.santa_games(id),
  participant_id uuid not null references public.santa_participants(id),
  request_id uuid not null,
  answers jsonb not null,
  correct_count integer not null,
  created_at timestamptz not null default now(),
  primary key (game_id,participant_id,request_id)
);
create view public.santa_game_schedule as
  select id,year,starts_at,lead(starts_at) over(partition by year order by starts_at) as ends_at
  from public.santa_games where published;

alter table public.santa_games enable row level security;
alter table public.santa_game_results enable row level security;
alter table public.santa_game_attempts enable row level security;
revoke all on public.santa_games,public.santa_game_results,public.santa_game_attempts,public.santa_game_schedule from public,anon,authenticated;
grant select,insert,update on public.santa_games,public.santa_game_results,public.santa_game_attempts to service_role;
grant select on public.santa_game_schedule to service_role;

create function public.santa_games_save(input_year integer,input_game jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  old public.santa_games;
  game_id uuid;
  start_time timestamptz;
  question jsonb;
  option_value jsonb;
  answer_value jsonb;
  position integer := 0;
  current_time_value timestamptz;
begin
  perform 1 from public.santa_settings where id = 1 for update;
  current_time_value := clock_timestamp();
  if not exists(select 1 from public.santa_event where year = input_year) then raise exception 'SANTA_YEAR_NOT_FOUND'; end if;
  if jsonb_typeof(input_game) is distinct from 'object'
    or coalesce(input_game->>'kind','') not in ('story','image')
    or jsonb_typeof(input_game->'title') is distinct from 'string'
    or char_length(btrim(input_game->>'title')) not between 1 and 120
    or jsonb_typeof(input_game->'body') is distinct from 'string'
    or char_length(btrim(input_game->>'body')) not between 1 and 16000
    or jsonb_typeof(input_game->'questions') is distinct from 'array'
    or jsonb_typeof(input_game->'solutions') is distinct from 'array'
    or jsonb_typeof(input_game->'published') is distinct from 'boolean'
    or coalesce(input_game->>'revision','') !~ '^[0-9]{1,15}$'
    or char_length(coalesce(input_game->>'revealText','')) > 4000
    then raise exception 'SANTA_GAME_INVALID'; end if;
  if jsonb_array_length(input_game->'questions') not between 1 and 3
    or jsonb_array_length(input_game->'solutions') <> jsonb_array_length(input_game->'questions') then raise exception 'SANTA_GAME_INVALID'; end if;
  for question in select value from jsonb_array_elements(input_game->'questions') loop
    if jsonb_typeof(question) is distinct from 'object' or (question - 'label' - 'options') <> '{}'::jsonb
      or jsonb_typeof(question->'label') is distinct from 'string' or char_length(btrim(question->>'label')) not between 1 and 160
      or jsonb_typeof(question->'options') is distinct from 'array' then raise exception 'SANTA_GAME_INVALID'; end if;
    if jsonb_array_length(question->'options') not between 2 and 10 then raise exception 'SANTA_GAME_INVALID'; end if;
    for option_value in select value from jsonb_array_elements(question->'options') loop
      if jsonb_typeof(option_value) <> 'string' or char_length(btrim(option_value#>>'{}')) not between 1 and 80 then raise exception 'SANTA_GAME_INVALID'; end if;
    end loop;
    if (select count(distinct btrim(value)) from jsonb_array_elements_text(question->'options')) <> jsonb_array_length(question->'options') then raise exception 'SANTA_GAME_INVALID'; end if;
    answer_value := input_game->'solutions'->position;
    if jsonb_typeof(answer_value) <> 'number' or (answer_value#>>'{}') !~ '^[0-9]$' then raise exception 'SANTA_GAME_INVALID'; end if;
    if (answer_value#>>'{}')::integer >= jsonb_array_length(question->'options') then raise exception 'SANTA_GAME_INVALID'; end if;
    position := position + 1;
  end loop;
  if input_game->>'kind' = 'image' and (coalesce(input_game->>'imageData','') !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'
    or char_length(input_game->>'imageData') > 700000) then raise exception 'SANTA_GAME_INVALID'; end if;
  begin
    game_id := (input_game->>'id')::uuid;
    start_time := (input_game->>'startsAt')::timestamptz;
  exception when others then raise exception 'SANTA_GAME_INVALID';
  end;
  if game_id is null or start_time is null or not isfinite(start_time) then raise exception 'SANTA_GAME_INVALID'; end if;
  select * into old from public.santa_games where id = game_id;
  if found then
    if old.year <> input_year then raise exception 'SANTA_GAME_NOT_FOUND'; end if;
    if old.revision <> (input_game->>'revision')::bigint then raise exception 'SANTA_CHANGED'; end if;
    if old.locked_at is not null then raise exception 'SANTA_GAME_LOCKED'; end if;
    if exists(select 1 from public.santa_game_schedule where id = old.id and ends_at <= current_time_value) then raise exception 'SANTA_GAME_LOCKED'; end if;
    if old.published and old.starts_at <= current_time_value and
      (not (input_game->>'published')::boolean or old.starts_at <> start_time) then raise exception 'SANTA_GAME_SCHEDULE'; end if;
  elsif (input_game->>'revision')::bigint <> 0 then raise exception 'SANTA_CHANGED';
  end if;
  if (input_game->>'published')::boolean and
    (old.id is null or not old.published or old.starts_at <> start_time) and start_time <= current_time_value then
    raise exception 'SANTA_GAME_FUTURE';
  end if;
  if exists(select 1 from public.santa_games where year = input_year and id <> game_id and published and starts_at = start_time)
    and (input_game->>'published')::boolean then raise exception 'SANTA_GAME_TIME_TAKEN'; end if;
  insert into public.santa_games(id,year,kind,title,body,questions,solutions,image_data,reveal_text,starts_at,published)
  values(game_id,input_year,input_game->>'kind',btrim(input_game->>'title'),btrim(input_game->>'body'),
    input_game->'questions',input_game->'solutions',case when input_game->>'kind' = 'image' then input_game->>'imageData' end,
    coalesce(input_game->>'revealText',''),start_time,(input_game->>'published')::boolean)
  on conflict(id) do update set kind = excluded.kind,title = excluded.title,body = excluded.body,questions = excluded.questions,
    solutions = excluded.solutions,image_data = excluded.image_data,reveal_text = excluded.reveal_text,starts_at = excluded.starts_at,
    published = excluded.published,revision = public.santa_games.revision + 1;
  return game_id;
end;
$$;

create function public.santa_games_admin(input_year integer,input_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.santa_event where year = input_year) then raise exception 'SANTA_YEAR_NOT_FOUND'; end if;
  if input_id is not null and not exists(select 1 from public.santa_games where id = input_id and year = input_year) then raise exception 'SANTA_GAME_NOT_FOUND'; end if;
  return jsonb_build_object('year',input_year,'serverNow',now(),
    'games',coalesce((select jsonb_agg(jsonb_build_object(
      'id',g.id,'title',g.title,'kind',g.kind,'startsAt',g.starts_at,'endsAt',s.ends_at,
      'published',g.published,'revision',g.revision,'lockedAt',g.locked_at,
      'status',case when not g.published then 'draft' when g.starts_at > now() then 'scheduled' when s.ends_at <= now() then 'archived' else 'active' end,
      'playerCount',(select count(*) from public.santa_game_results where game_id = g.id),
      'attemptCount',(select coalesce(sum(attempts),0) from public.santa_game_results where game_id = g.id)
    ) order by g.starts_at desc,g.id) from public.santa_games g left join public.santa_game_schedule s on s.id = g.id where g.year = input_year),'[]'::jsonb),
    'selectedGame',(select jsonb_build_object('id',id,'kind',kind,'title',title,'body',body,'questions',questions,'solutions',solutions,
      'imageData',image_data,'revealText',reveal_text,'startsAt',starts_at,'published',published,'revision',revision,'lockedAt',locked_at)
      from public.santa_games where id = input_id and year = input_year),
    'results',coalesce((select jsonb_agg(jsonb_build_object('participantId',r.participant_id,'name',r.participant_name,
      'attempts',r.attempts,'bestCorrect',r.best_correct,'solved',r.solved,'answers',r.answers,'solvedAt',r.solved_at,'updatedAt',r.updated_at) order by r.participant_name,r.participant_id)
      from public.santa_game_results r where game_id = input_id),'[]'::jsonb));
end;
$$;


create function public.santa_games_public(input_year integer,input_game uuid default null,input_participant uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_time_value timestamptz := clock_timestamp();
  event public.santa_event;
  current_id uuid;
  chosen public.santa_games;
  chosen_end timestamptz;
  result public.santa_game_results;
  archived boolean := false;
  detail jsonb := null;
begin
  if input_year is distinct from (select active_year from public.santa_settings where id = 1) then raise exception 'SANTA_YEAR_CHANGED'; end if;
  select * into event from public.santa_event where year = input_year;
  if input_participant is not null and not exists(select 1 from public.santa_draw_entries where year = input_year and version = event.current_version and giver_id = input_participant) then raise exception 'SANTA_GAME_PLAYER'; end if;
  select id into current_id from public.santa_game_schedule
    where year = input_year and starts_at <= current_time_value and (ends_at is null or ends_at > current_time_value);
  select * into chosen from public.santa_games where id = coalesce(input_game,current_id) and year = input_year and published and starts_at <= current_time_value;
  if input_game is not null and chosen.id is null then raise exception 'SANTA_GAME_NOT_FOUND'; end if;
  if chosen.id is not null then
    select ends_at into chosen_end from public.santa_game_schedule where id = chosen.id;
    archived := coalesce(chosen_end <= current_time_value,false);
    select * into result from public.santa_game_results where game_id = chosen.id and participant_id = input_participant;
    detail := jsonb_build_object('id',chosen.id,'title',chosen.title,'kind',chosen.kind,'body',chosen.body,
      'questions',chosen.questions,'imageData',chosen.image_data,'startsAt',chosen.starts_at,'endsAt',chosen_end,'revision',chosen.revision,
      'status',case when archived then 'archived' else 'active' end,
      'solutions',case when archived or coalesce(result.solved,false) then chosen.solutions else null end,
      'revealText',case when archived or coalesce(result.solved,false) then chosen.reveal_text else '' end,
      'progress',case when result.game_id is null then null else jsonb_build_object('attempts',result.attempts,'bestCorrect',result.best_correct,'solved',result.solved,'answers',result.answers,'solvedAt',result.solved_at) end,
      'players',coalesce((select jsonb_agg(jsonb_build_object('name',r.participant_name,'attempts',r.attempts,
        'bestCorrect',r.best_correct,'solved',r.solved,'solvedAt',r.solved_at,'updatedAt',r.updated_at) order by r.participant_name,r.participant_id)
        from public.santa_game_results r where r.game_id = chosen.id),'[]'::jsonb));
  end if;
  return jsonb_build_object('year',input_year,'serverNow',current_time_value,'currentGameId',current_id,
    'nextStartsAt',(select min(starts_at) from public.santa_game_schedule where year = input_year and starts_at > current_time_value),
    'names',coalesce((select jsonb_agg(jsonb_build_object('id',e.giver_id,'name',e.giver_name,
      'attempts',(select coalesce(sum(r.attempts),0) from public.santa_game_results r join public.santa_games g on g.id = r.game_id where r.participant_id = e.giver_id and g.year = input_year),
      'correctAnswers',(select coalesce(sum(r.best_correct),0) from public.santa_game_results r join public.santa_games g on g.id = r.game_id where r.participant_id = e.giver_id and g.year = input_year),
      'solvedGames',(select count(*) from public.santa_game_results r join public.santa_games g on g.id = r.game_id where r.participant_id = e.giver_id and g.year = input_year and r.solved)
    ) order by e.giver_name,e.giver_id) from public.santa_draw_entries e where e.year = input_year and e.version = event.current_version and e.giver_id is not null),'[]'::jsonb),
    'games',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'title',g.title,'kind',g.kind,'startsAt',g.starts_at,'endsAt',s.ends_at,
      'status',case when s.ends_at <= current_time_value then 'archived' else 'active' end)
      order by g.starts_at desc) from public.santa_games g join public.santa_game_schedule s on s.id = g.id where g.year = input_year and g.starts_at <= current_time_value),'[]'::jsonb),
    'game',detail);
end;
$$;

create function public.santa_games_attempt(input_year integer,input_game uuid,input_participant uuid,input_answers jsonb,input_request uuid,input_revision bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  game public.santa_games;
  result public.santa_game_results;
  previous public.santa_game_attempts;
  end_time timestamptz;
  now_time timestamptz;
  answer_value jsonb;
  position integer := 0;
  correct integer := 0;
  player_name text;
begin
  perform 1 from public.santa_settings where id = 1 for update;
  now_time := clock_timestamp();
  if input_year is distinct from (select active_year from public.santa_settings where id = 1) then raise exception 'SANTA_YEAR_CHANGED'; end if;
  select e.giver_name into player_name from public.santa_draw_entries e join public.santa_event event on event.year = e.year
    where e.year = input_year and e.version = event.current_version and e.giver_id = input_participant;
  if player_name is null then raise exception 'SANTA_GAME_PLAYER'; end if;
  select * into game from public.santa_games where id = input_game and year = input_year and published;
  if not found then raise exception 'SANTA_GAME_NOT_FOUND'; end if;
  if game.revision is distinct from input_revision then raise exception 'SANTA_CHANGED'; end if;
  if input_request is null then raise exception 'SANTA_GAME_INVALID'; end if;
  select * into previous from public.santa_game_attempts where game_id = input_game and participant_id = input_participant and request_id = input_request;
  if found then
    if previous.answers is distinct from input_answers then raise exception 'SANTA_RETRY_CHANGED'; end if;
    return jsonb_build_object('correctCount',previous.correct_count,'duplicate',true);
  end if;
  select ends_at into end_time from public.santa_game_schedule where id = input_game;
  if game.starts_at > now_time or end_time <= now_time then raise exception 'SANTA_GAME_ENDED'; end if;
  if jsonb_typeof(input_answers) is distinct from 'array' then raise exception 'SANTA_GAME_INVALID'; end if;
  if jsonb_array_length(input_answers) <> jsonb_array_length(game.questions) then raise exception 'SANTA_GAME_INVALID'; end if;
  for answer_value in select value from jsonb_array_elements(input_answers) loop
    if jsonb_typeof(answer_value) <> 'number' or (answer_value#>>'{}') !~ '^[0-9]$' then raise exception 'SANTA_GAME_INVALID'; end if;
    if (answer_value#>>'{}')::integer >= jsonb_array_length(game.questions->position->'options') then raise exception 'SANTA_GAME_INVALID'; end if;
    if answer_value = game.solutions->position then correct := correct + 1; end if;
    position := position + 1;
  end loop;
  select * into result from public.santa_game_results where game_id = input_game and participant_id = input_participant;
  if coalesce(result.solved,false) then return jsonb_build_object('correctCount',position,'alreadySolved',true); end if;
  update public.santa_games set locked_at = coalesce(locked_at,now_time) where id = input_game;
  insert into public.santa_game_attempts(game_id,participant_id,request_id,answers,correct_count)
    values(input_game,input_participant,input_request,input_answers,correct);
  insert into public.santa_game_results(game_id,participant_id,participant_name,attempts,best_correct,solved,answers,solved_at,updated_at)
    values(input_game,input_participant,player_name,1,correct,correct = position,input_answers,case when correct = position then now_time end,now_time)
  on conflict(game_id,participant_id) do update set attempts = public.santa_game_results.attempts + 1,
    best_correct = greatest(public.santa_game_results.best_correct,excluded.best_correct),solved = excluded.solved,
    answers = excluded.answers,solved_at = excluded.solved_at,updated_at = excluded.updated_at;
  return jsonb_build_object('correctCount',correct,'duplicate',false);
end;
$$;

create or replace function public.santa_rate_limit(input_key text,input_scope text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  current_bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / 900) * 900);
  attempt_count integer;
  allowed_count integer;
begin
  allowed_count := case input_scope when 'submit' then 20 when 'login' then 10 when 'admin' then 300 when 'games-read' then 3000 when 'games-play' then 200 else 0 end;
  delete from public.santa_rate_limits where bucket < now() - interval '1 day';
  insert into public.santa_rate_limits(client_key,scope,bucket) values(input_key,input_scope,current_bucket)
    on conflict(client_key,scope,bucket) do update set attempts = public.santa_rate_limits.attempts + 1 returning attempts into attempt_count;
  return attempt_count <= allowed_count;
end;
$$;
revoke all on function public.santa_games_save(integer,jsonb),public.santa_games_admin(integer,uuid),
  public.santa_games_public(integer,uuid,uuid),public.santa_games_attempt(integer,uuid,uuid,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.santa_games_save(integer,jsonb),public.santa_games_admin(integer,uuid),
  public.santa_games_public(integer,uuid,uuid),public.santa_games_attempt(integer,uuid,uuid,jsonb,uuid,bigint) to service_role;
commit;
