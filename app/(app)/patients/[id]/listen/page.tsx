import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDemoActive } from "@/lib/auth";
import { loadCounselingDataForStaff } from "@/lib/counselingData";
import { MotherAudioPlayer } from "@/components/MotherAudioPlayer";
import type { CounselingLanguage } from "@/lib/voiceCounselor";

export default async function PatientListenPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { id } = await params;
  const { lang } = await searchParams;
  const cookieStore = await cookies();
  const isDemo = isDemoActive(cookieStore);
  const supabase = await createClient();

  // Minimal fields only (RLS scopes the patient to the caller's clinic; no phone).
  const patientData = await loadCounselingDataForStaff(supabase, id, { demo: isDemo });
  if (!patientData) notFound();

  const selectedLang = (["hi", "mr", "gu", "en"].includes(lang || "") ? lang : "hi") as CounselingLanguage;

  return (
    <MotherAudioPlayer
      initialLang={selectedLang}
      patientData={patientData}
      audioEndpoint={`/api/gnani/tts/counsel?patientId=${encodeURIComponent(id)}`}
    />
  );
}
