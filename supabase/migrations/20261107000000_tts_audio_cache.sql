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
