import type { AppRoot } from "@fungi.computer/agar";
import type { ParakeetToast } from "@fungi.computer/parakeet/headless";

/** A Conversation's transient message goes to the host's toast, not into the page. */
export function showConversationToast(
  ui: AppRoot["ui"] | null,
  toast: ParakeetToast,
): void {
  if (ui === null) return;
  void ui
    .showToast({ message: toast.message, tone: toast.variant })
    .catch((cause: unknown) => {
      console.error("Chat toast failed", cause);
    });
}
