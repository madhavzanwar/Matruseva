import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isDemoActive } from "@/lib/auth";
import { verifyListenToken } from "@/lib/listenLink";
import { loadCounselingDataForToken } from "@/lib/counselingData";
import { MotherAudioPlayer } from "@/components/MotherAudioPlayer";

// Public, token-gated page: keep it out of search indexes and never leak the
// token (it is in the URL) via the Referer header.
export const metadata: Metadata = {
  title: "MatruSetu",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function PublicListenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Generic outcome for bad signature, expiry, tampering or missing secret.
  let raw = token;
  try {
    raw = decodeURIComponent(token);
  } catch {
    notFound();
  }
  const link = verifyListenToken(raw);
  if (!link) notFound();

  const cookieStore = await cookies();

  // Only the minimal fields ever leave the server (no phone, address or other PII).
  const patientData = await loadCounselingDataForToken(link.patientId, { demo: isDemoActive(cookieStore) });
  if (!patientData) notFound();

  return (
    <MotherAudioPlayer
      publicView
      initialLang={link.lang}
      patientData={patientData}
      // Server-built counselling audio (Gnani Timbre); the player falls back to the browser voice on any failure.
      audioEndpoint={`/listen/${token}/audio`}
    />
  );
}
