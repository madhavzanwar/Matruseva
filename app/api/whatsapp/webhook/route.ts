import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { handleIncomingWhatsAppMessage } from "@/lib/whatsappBot";
import { handleWhatsAppAudioMessage } from "@/lib/whatsappVoice";
import { canSendWhatsApp, sendWhatsAppText } from "@/lib/whatsappMedia";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // voice notes: Graph download + Prisma + optional Timbre

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Verifies Meta's X-Hub-Signature-256 (HMAC-SHA256 of the raw body, keyed with the app secret). */
function hasValidSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(header.slice("sha256=".length), expected);
}

async function processMessage(msg: { type?: string; from?: string; text?: { body?: string }; audio?: { id?: string } }) {
  if (msg.type === "text" && msg.text?.body) {
    const fromPhone = msg.from;
    const result = await handleIncomingWhatsAppMessage({ phone: fromPhone, messageText: msg.text.body });
    // If Meta Cloud API credentials are set, send the WhatsApp reply back
    if (fromPhone && canSendWhatsApp()) {
      try {
        await sendWhatsAppText(fromPhone, result.replyText);
      } catch (apiErr) {
        console.error("Meta Graph API delivery error:", apiErr instanceof Error ? apiErr.name : "unknown");
      }
    }
    return;
  }
  if (msg.type === "audio" && msg.audio?.id) {
    await handleWhatsAppAudioMessage(msg);
  }
}

/**
 * Meta WhatsApp Cloud API Webhook Verification Endpoint (GET).
 * Requires WHATSAPP_VERIFY_TOKEN — there is deliberately no default value.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (verifyToken && mode === "subscribe" && token && safeEqual(token, verifyToken)) {
    return new Response(challenge || "", { status: 200 });
  }

  return new Response("Forbidden: Invalid verification token", { status: 403 });
}

/**
 * Meta WhatsApp Cloud API incoming message webhook (POST).
 * Every request must carry a valid X-Hub-Signature-256 (WHATSAPP_APP_SECRET);
 * this route uses the service-role client, so it must never accept unsigned input.
 * The in-app bot simulator does not use this route — it calls the authenticated
 * `processBotReply` server action instead.
 */
export async function POST(req: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  if (!hasValidSignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody);

    if (body.object === "whatsapp_business_account" && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value;
          if (value?.messages && Array.isArray(value.messages)) {
            for (const msg of value.messages) {
              // One bad message must never fail the batch: Meta would retry the whole delivery.
              try {
                await processMessage(msg);
              } catch (msgErr) {
                console.error("WhatsApp message processing error:", msgErr instanceof Error ? msgErr.name : "unknown");
              }
            }
          }
        }
      }

      return NextResponse.json({ status: "EVENT_RECEIVED" });
    }

    return NextResponse.json({ error: "Invalid payload format" }, { status: 400 });
  } catch (err: unknown) {
    console.error("WhatsApp webhook error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
