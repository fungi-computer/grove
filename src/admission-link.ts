import { failureMessage } from "@fungi.computer/agar/errors";
import type { AppRoot } from "@fungi.computer/agar";

/** Billing intent leaves the App through its host, which owns the current Team. */
export function openAdmissionLink(
  ui: AppRoot["ui"] | null,
  href: string,
): boolean {
  if (ui === null || !URL.canParse(href)) return false;
  const url = new URL(href);
  if (url.protocol !== "https:" || url.hash !== "#team-billing") return false;
  void ui.openTeamBilling().catch((cause: unknown) => {
    console.error("Chat Billing navigation failed", cause);
    return ui.showToast({
      message: failureMessage("Billing could not be opened", cause),
      tone: "error",
    });
  });
  return true;
}
