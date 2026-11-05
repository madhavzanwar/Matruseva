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
