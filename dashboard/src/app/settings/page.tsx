import { redirect } from "next/navigation";

/**
 * /settings landing → redirects to the onboarding checklist.
 *
 * Settings has four sub-routes now:
 *   /settings/onboarding     first-run checklist
 *   /settings/data           content pipeline + drafts
 *   /settings/website-pages  per-URL cluster/lang overrides
 *   /settings/ai-workflows   Claude skill-prompt catalog
 *
 * Anyone hitting /settings bare should see Onboarding first — it's
 * the "what do I do here" landing for a fresh install, and a
 * reassuring index for returning users.
 */
export default function SettingsIndexPage() {
  redirect("/settings/onboarding");
}
