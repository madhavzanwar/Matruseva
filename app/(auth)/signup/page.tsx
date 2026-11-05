import { isDemoModeEnabled } from "@/lib/demo";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return <SignupForm demo={isDemoModeEnabled()} />;
}
