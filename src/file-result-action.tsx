import { failureMessage } from "@fungi.computer/agar/errors";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { Button } from "@fungi.computer/caps/components/button";
import type { AppRoot } from "@fungi.computer/agar";
import { readOutputSchema } from "@fungi.computer/knapsack/files-read";
import type { ParakeetToolItem } from "@fungi.computer/parakeet";
import { useState } from "react";
import { showConversationToast } from "./conversation-toast.js";

/** Recognize a complete read result as a navigation hint, never as file authority. */
function fileReference(item: ParakeetToolItem) {
  if (item.name !== "execute" || item.status !== "completed") return undefined;
  const content = item.result?.content;
  if (content?.length !== 1 || content[0]?.type !== "text") return undefined;
  const value = Schema.decodeUnknownOption(
    Schema.fromJsonString(Schema.Unknown),
  )(content[0].text);
  if (Option.isNone(value)) return undefined;
  const result = readOutputSchema.safeParse(value.value);
  return result.success ? result.data.file : undefined;
}

export function FileResultAction({
  item,
  ui,
}: {
  item: ParakeetToolItem;
  ui: AppRoot["ui"];
}): React.JSX.Element | null {
  const file = fileReference(item);
  const [pending, setPending] = useState(false);
  if (!file) return null;
  const open = async () => {
    setPending(true);
    try {
      await ui.openNavigation(file);
    } catch (cause) {
      console.error("Chat file navigation failed", cause);
      showConversationToast(ui, {
        variant: "error",
        message: failureMessage("The file could not be opened", cause),
      });
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="px-3 py-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => void open()}
        type="button"
      >
        {pending ? "Opening file…" : `Open ${file.path} in Inkcap`}
      </Button>
    </div>
  );
}
