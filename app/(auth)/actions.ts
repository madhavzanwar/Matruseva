"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate-client";
import { DEMO_COOKIE, DEMO_EMAIL, DEMO_PASSWORD, isDemoModeEnabled } from "@/lib/demo";

export interface ActionResult {
  error: string | null;
  checkEmail?: boolean;
}

const credentialsSchema = (t: Translator) =>
  z.object({
    email: z.email(t("auth.error.email")),
    password: z.string().min(8, t("auth.error.passwordLength")),
  });

async function startDemoSession(): Promise<never> {
  const cookieStore = await cookies();
  cookieStore.set(DEMO_COOKIE, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect("/today");
}

export async function loginDemo(): Promise<void> {
  if (!isDemoModeEnabled()) redirect("/login");
  await startDemoSession();
}

export async function login(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { t } = await getT();
  const parsed = credentialsSchema(t).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Demo bypass mode for offline evaluation / local testing
  if (
    isDemoModeEnabled() &&
    parsed.data.email.toLowerCase() === DEMO_EMAIL &&
    parsed.data.password === DEMO_PASSWORD
  ) {
    await startDemoSession();
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: t("auth.error.credentials") };
  }

  redirect("/today");
}

export async function signup(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { t } = await getT();
  const parsed = credentialsSchema(t).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Demo bypass mode: allow signing up with demo credentials
  if (
    isDemoModeEnabled() &&
    parsed.data.email.toLowerCase() === DEMO_EMAIL &&
    parsed.data.password === DEMO_PASSWORD
  ) {
    await startDemoSession();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);
  if (error) {
    return { error: error.message };
  }

  // If email confirmation is required, signUp succeeds but returns no
  // active session — there's nothing to onboard into yet.
  if (!data.session) {
    return { error: null, checkEmail: true };
  }

  redirect("/onboarding");
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(DEMO_COOKIE);
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const onboardingSchema = (t: Translator) =>
  z.object({
    clinicName: z.string().min(2, t("auth.error.clinicName")),
    doctorFullName: z.string().min(2, t("auth.error.fullName")),
  });

export async function completeOnboarding(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { t } = await getT();
  const parsed = onboardingSchema(t).safeParse({
    clinicName: formData.get("clinicName"),
    doctorFullName: formData.get("doctorFullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("auth.error.sessionExpired") };
  }

  const { error } = await supabase.rpc("create_clinic_and_profile", {
    clinic_name: parsed.data.clinicName,
    doctor_full_name: parsed.data.doctorFullName,
  });
  if (error) {
    return { error: error.message };
  }

  redirect("/today");
}
