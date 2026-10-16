import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { Button } from "@fungi.computer/caps/components/button";
import type { AppRoot } from "@fungi.computer/agar";
import type { ParakeetToolItem } from "@fungi.computer/parakeet";
import { useState } from "react";
import { z } from "zod";

/**
 * `images.generate`'s own "generated" result, as its Mycelium output schema
 * shapes it. The inline picture itself is not this card's job: Parakeet's
 * `ToolGroup` already renders every `{ type: "image" }` content part a tool
 * result carries (`packages/parakeet/src/components/ToolGroup.tsx`), which is
 * how `images.view`'s result shows up automatically. This card is only a
 * recognition hint, never file authority, matching `FileResultAction`.
 */
const generatedImageSchema = z.strictObject({
  kind: z.literal("generated"),
  file: z.strictObject({
    computerId: z.string().min(1),
    path: z.string().min(1),
  }),
  format: z.enum(["png", "jpeg", "gif", "webp", "mp4"]),
  width: z.number(),
  height: z.number(),
  bytes: z.number(),
  costMilliunits: z.number(),
  receipt: z.string(),
});

function generatedImage(item: ParakeetToolItem) {
  if (item.name !== "execute" || item.status !== "completed") return undefined;
  // The text part leads; images an `images.view` in the same execute call
  // pushed follow it as image parts, which Parakeet renders inline.
  const content = item.result?.content ?? [];
  const head = content.at(0);
  if (
    head?.type !== "text" ||
    content.slice(1).some((part) => part.type !== "image")
  )
    return undefined;
  const value = Schema.decodeUnknownOption(
    Schema.fromJsonString(Schema.Unknown),
  )(head.text);
  if (Option.isNone(value)) return undefined;
  const result = generatedImageSchema.safeParse(value.value);
  return result.success ? result.data : undefined;
}

export function ImageResultCard({
  item,
  ui,
}: {
  item: ParakeetToolItem;
  ui: AppRoot["ui"];
}): React.JSX.Element | null {
  const generated = generatedImage(item);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!generated) return null;
  const open = async () => {
    setPending(true);
    setFailed(false);
    try {
      await ui.openNavigation(generated.file);
    } catch (cause) {
      console.error("Chat image navigation failed", cause);

      setFailed(true);
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
        {pending ? "Opening file…" : `Open ${generated.file.path} in Inkcap`}
      </Button>
      {failed ? (
        <p role="alert">The file could not be opened. Try again.</p>
      ) : null}
    </div>
  );
}
