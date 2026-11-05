"use client";

import { useActionState } from "react";
import Link from "next/link";
import { CheckCircle, Sparkle } from "@phosphor-icons/react";
import { signup, loginDemo, type ActionResult } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { AuthShell } from "@/components/auth/AuthShell";
import { useT } from "@/lib/i18n/provider";
import { DEMO_EMAIL } from "@/lib/demo";

const initialState: ActionResult = { error: null };

export function SignupForm({ demo }: { demo: boolean }) {
  const t = useT();
  const [state, formAction] = useActionState(signup, initialState);

  if (state.checkEmail) {
    return (
      <AuthShell>
        <div className="text-center">
          <CheckCircle size={40} weight="fill" className="mx-auto text-[var(--color-on-track)]" aria-hidden />
          <h1 className="mt-4 mb-1 text-[20px] font-semibold tracking-tight text-[var(--color-foreground)]">
            {t("auth.signup.checkEmail.title")}
          </h1>
          <p className="text-[var(--color-charcoal)]">
            {t("auth.signup.checkEmail.body")}
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div>
        <h1 className="mb-1 text-[24px] font-semibold tracking-tight text-[var(--color-foreground)]">
          {t("auth.signup.title")}
        </h1>
        <p className="mb-6 text-[14px] text-[var(--color-charcoal)]">{t("auth.signup.subtitle")}</p>
        <form action={formAction} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-[var(--color-charcoal)]">
              {t("auth.field.email")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder={demo ? DEMO_EMAIL : undefined}
              required
              className="min-h-11 w-full border border-[var(--color-border-strong)] bg-[var(--color-background)] px-3 text-[15px]"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-[var(--color-charcoal)]">
              {t("auth.field.password")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="min-h-11 w-full border border-[var(--color-border-strong)] bg-[var(--color-background)] px-3 text-[15px]"
            />
            <p className="mt-1 text-xs text-[var(--color-charcoal)]">{t("auth.signup.passwordHint")}</p>
          </div>

          {state.error && (
            <p role="alert" className="text-sm text-[var(--color-overdue)]">
              {state.error}
            </p>
          )}

          <SubmitButton>{t("auth.signup.submit")}</SubmitButton>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-[var(--color-charcoal)]">
          <span className="h-px flex-1 bg-[var(--color-border)]" />
          {t("auth.signup.or")}
          <span className="h-px flex-1 bg-[var(--color-border)]" />
        </div>
        <GoogleSignInButton />

        {demo && (
        <form action={loginDemo} className="mt-3">
          <button
            type="submit"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-[15px] font-medium text-[var(--color-foreground)] transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-hover)]"
          >
            <Sparkle size={18} weight="fill" className="text-[var(--color-primary)]" aria-hidden />
            {t("auth.login.demoButton")}
          </button>
        </form>
        )}

        <p className="mt-6 text-sm">
          {t("auth.signup.haveAccount")}{" "}
          <Link href="/login" className="font-medium text-[var(--color-primary)] underline">
            {t("auth.signup.signIn")}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
