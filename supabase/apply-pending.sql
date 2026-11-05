-- =============================================================================
-- MatruSetu: apply the pending database migrations in ONE paste.
--
-- Where:  Supabase dashboard -> your project -> SQL Editor -> New query -> paste -> Run
-- Expect: "Success. No rows returned"
--
-- Safe to run more than once (every statement is re-runnable), and safe if you
-- already applied some of these. Run it BEFORE deploying the new code.
-- Combined from supabase/migrations/ in this order:
--   1. 20261104000000_latest_visits_view    (fast "latest visit per patient" view)
--   2. 20261105000000_client_request_id     (offline queue: no duplicate visits/calls)
--   3. 20261106000000_patient_clinic_check  (security: rows must belong to your clinic's patient)
--   4. 20261107000000_tts_audio_cache       (private bucket for cached Gnani voice audio)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 20261104000000_latest_visits_view
-- ---------------------------------------------------------------------------
-- Additive migration: latest visit per patient.
-- Replaces the app-side "fetch up to 5000 visits, keep the newest per patient"
-- pattern in lib/snapshot.ts with a DB-side DISTINCT ON.

-- Supports DISTINCT ON (patient_id) ordered by newest visit first.
create index if not exists visits_patient_latest_idx
  on public.visits (patient_id, visit_date desc, created_at desc);

-- security_invoker so the querying user's RLS on public.visits applies
-- (same as care_event_status / patient_followup_risk).
create or replace view public.latest_visits
with (security_invoker = true) as
select distinct on (v.patient_id)
  v.id,
  v.patient_id,
  v.clinic_id,
  v.visit_date,
  v.ga_weeks,
  v.bp_sys,
  v.bp_dia,
  v.weight,
  v.hb,
  v.fhr,
  v.fundal_height,
  v.notes,
  v.next_visit_date,
  v.created_by,
  v.created_at
from public.visits v
order by v.patient_id, v.visit_date desc, v.created_at desc;

grant select on public.latest_visits to authenticated;

-- ---------------------------------------------------------------------------
-- 20261105000000_client_request_id
-- ---------------------------------------------------------------------------
-- Additive migration: idempotency keys for the offline write queue.
-- The browser queues visits / contact-log entries while offline and replays
-- them later. If a request reached the server but the response was lost, the
-- replay would duplicate the row; a client-generated UUID with a unique index
-- lets the server recognise (and ignore) the replay.

alter table public.visits
  add column if not exists client_request_id uuid;

alter table public.contact_log
  add column if not exists client_request_id uuid;

-- Partial: rows written online without a key (or before this migration) are unaffected.
create unique index if not exists visits_client_request_id_uidx
  on public.visits (client_request_id)
  where client_request_id is not null;

create unique index if not exists contact_log_client_request_id_uidx
  on public.contact_log (client_request_id)
  where client_request_id is not null;

-- ---------------------------------------------------------------------------
-- 20261106000000_patient_clinic_check
-- ---------------------------------------------------------------------------
-- Cross-clinic patient_id gap: write policies only checked clinic_id, so a caller
-- could attach rows to another clinic's patient. Require the referenced patient
-- to belong to the caller's clinic too. Only documents.patient_id is nullable
-- (inbox documents); visits, care_events and contact_log always have a patient.

drop policy care_events_insert on public.care_events;
drop policy care_events_update on public.care_events;
create policy care_events_insert on public.care_events for insert to authenticated
  with check (
    clinic_id = (select private.current_clinic_id())
    and exists (select 1 from public.patients p where p.id = patient_id and p.clinic_id = (select private.current_clinic_id()))
  );
create policy care_events_update on public.care_events for update to authenticated
  using (clinic_id = (select private.current_clinic_id()))
  with check (
    clinic_id = (select private.current_clinic_id())
    and exists (select 1 from public.patients p where p.id = patient_id and p.clinic_id = (select private.current_clinic_id()))
  );

drop policy visits_insert on public.visits;
drop policy visits_update on public.visits;
create policy visits_insert on public.visits for insert to authenticated
  with check (
    clinic_id = (select private.current_clinic_id())
    and exists (select 1 from public.patients p where p.id = patient_id and p.clinic_id = (select private.current_clinic_id()))
  );
create policy visits_update on public.visits for update to authenticated
  using (clinic_id = (select private.current_clinic_id()))
  with check (
    clinic_id = (select private.current_clinic_id())
    and exists (select 1 from public.patients p where p.id = patient_id and p.clinic_id = (select private.current_clinic_id()))
  );

drop policy documents_insert on public.documents;
drop policy documents_update on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (
    clinic_id = (select private.current_clinic_id())
    and (patient_id is null or exists (select 1 from public.patients p where p.id = patient_id and p.clinic_id = (select private.current_clinic_id())))
  );
create policy documents_update on public.documents for update to authenticated
  using (clinic_id = (select private.current_clinic_id()))
  with check (
    clinic_id = (select private.current_clinic_id())
    and (patient_id is null or exists (select 1 from public.patients p where p.id = patient_id and p.clinic_id = (select private.current_clinic_id())))
  );

drop policy contact_log_insert on public.contact_log;
create policy contact_log_insert on public.contact_log for insert to authenticated
  with check (
    clinic_id = (select private.current_clinic_id())
    and exists (select 1 from public.patients p where p.id = patient_id and p.clinic_id = (select private.current_clinic_id()))
  );

-- ---------------------------------------------------------------------------
-- 20261107000000_tts_audio_cache
-- ---------------------------------------------------------------------------
-- Private Storage bucket for cached Gnani Timbre counselling audio (mp3 parts).
-- Object path: {sha256[0:2]}/{sha256}.mp3, where the key is sha256(model|voice|language|speed|container|text),
-- so the same advice for the same patient state is synthesised (and paid for) once.
--
-- The audio is health data: the bucket is NOT public and has NO policies for
-- `anon` or `authenticated`. Only the server (service role, which bypasses RLS)
-- reads and writes it, through lib/gnani/counselAudio.ts. A counselling part is
-- at most ~350 characters of speech, i.e. well under 2 MB of mp3.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tts-audio', 'tts-audio', false, 2097152, array['audio/mpeg'])
on conflict (id) do nothing;
