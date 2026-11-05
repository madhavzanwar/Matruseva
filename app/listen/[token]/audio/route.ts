import { cookies } from "next/headers";
import { isDemoActive } from "@/lib/auth";
import { verifyListenToken } from "@/lib/listenLink";
import { loadCounselingDataForToken } from "@/lib/counselingData";
import { counselFail, parsePartParam, respondCounsel } from "@/lib/gnani/counselRoute";

export const runtime = "nodejs";
export const maxDuration = 60;

// Never reveal why a token failed: bad signature, expiry, tampering, missing secret and unknown patient all look the same.
const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

/**
 * GET /listen/[token]/audio[?part=n]   (public; the signed link is the credential)
 * Language comes from the token (a client `lang` is ignored). Same manifest / part contract as
 * /api/gnani/tts/counsel. Invalid or expired token -> 404 with an empty body.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let raw = token;
  try {
    raw = decodeURIComponent(token);
  } catch {
    return notFound();
  }
  const link = verifyListenToken(raw);
  if (!link) return notFound();

  const part = parsePartParam(new URL(request.url).searchParams.get("part"));
  if (part === "invalid") return counselFail(400, "bad_request");

  return respondCounsel({
    request,
    lang: link.lang,
    part,
    budgetKey: `public:${link.patientId}`,
    load: async () => loadCounselingDataForToken(link.patientId, { demo: isDemoActive(await cookies()) }),
    notFound,
  });
}
