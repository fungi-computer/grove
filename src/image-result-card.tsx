import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { Button } from "@fungi.computer/caps/components/button";
import type { AppRoot, CapabilityDirectory } from "@fungi.computer/agar";
import { openApp } from "@fungi.computer/agar/apps";
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

/**
 * Prints' `generateImage` result: the saved print's identity and place. Like the
 * Hub shape above it is a recognition hint; Prints resolves `printId` itself.
 */
const printsImageSchema = z.object({
  printId: z.string().min(1).max(256),
  destination: z.strictObject({
    computerId: z.string().min(1),
    path: z.string().min(1),
  }),
  format: z.enum(["png", "jpeg", "gif", "webp"]),
});
type PrintsPanel = z.output<typeof printsImageSchema>;
const jsonValue = z.json();
type JsonValue = z.output<typeof jsonValue>;
/** A returned value's children: an array's items or an object's values. */
const jsonChildren = z
  .array(jsonValue)
  .or(
    z
      .record(z.string(), jsonValue)
      .transform((record) => Object.values(record)),
  );

/**
 * Every `generateImage` result an execute returned, in order: one result, the
 * recipe's array, or an Agent's own wrapper such as
 * `{ panels: [{ panel, result }] }`. Refusals and other values are skipped;
 * the walk stops three levels down.
 */
function printsPanelsIn(value: JsonValue, depth: number): PrintsPanel[] {
  const panel = printsImageSchema.safeParse(value);
  if (panel.success) return [panel.data];
  if (depth >= 3) return [];
  const children = jsonChildren.safeParse(value);
  return children.success
    ? children.data.flatMap((child) => printsPanelsIn(child, depth + 1))
    : [];
}

/** At most 8 panels, the image collector's per-execute limit. */
const printsPanelsSchema = jsonValue
  .transform((value) => printsPanelsIn(value, 0))
  .pipe(z.array(printsImageSchema).min(1).max(8));

function parseResult<Output>(
  item: ParakeetToolItem,
  schema: z.ZodType<Output>,
): Output | undefined {
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
  const result = schema.safeParse(value.value);
  return result.success ? result.data : undefined;
}

/** Whether the card shows this tool result's picture, so the tool body must not repeat it. */
export function claimsPrintsPanel(item: ParakeetToolItem): boolean {
  return parseResult(item, printsPanelsSchema) !== undefined;
}

/** One Prints panel's "Open in Prints" action, through the media role. */
function PrintsResultAction({
  printId,
  pictures,
  capabilities,
}: {
  printId: string;
  pictures: readonly { data: string; mimeType: string }[];
  capabilities: CapabilityDirectory;
}): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const open = async () => {
    setPending(true);
    setFailed(false);
    try {
      await openApp(capabilities, {
        role: "media",
        intent: {
          kind: "navigate",
          params: [{ key: "print", value: printId }],
        },
      });
    } catch (cause) {
      console.error("Chat print navigation failed", cause);
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-2 px-3 py-2">
      {/* The collapsed tool row hides its images, so the panel shows here. */}
      {pictures.map((picture, index) => (
        <img
          alt="Panel saved in Prints"
          className="max-w-full rounded-box"
          key={index}
          src={`data:${picture.mimeType};base64,${picture.data}`}
          style={{ maxHeight: 320 }}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void open()}
        type="button"
      >
        {pending ? "Opening Prints…" : "Open in Prints"}
      </Button>
      {failed ? (
        <p role="alert">Prints could not be opened. Try again.</p>
      ) : null}
    </div>
  );
}

export function ImageResultCard({
  item,
  ui,
  capabilities,
}: {
  item: ParakeetToolItem;
  ui: AppRoot["ui"];
  capabilities?: CapabilityDirectory | undefined;
}): React.JSX.Element | null {
  const generated = parseResult(item, generatedImageSchema);
  const panels = parseResult(item, printsPanelsSchema);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (panels && capabilities) {
    const pictures = (item.result?.content ?? []).flatMap((part) =>
      part.type === "image" ? [part] : [],
    );
    // The recipe reads each panel's file in panel order, so one picture per
    // panel pairs by position; any other count shows them all with panel 1.
    const paired = pictures.length === panels.length;
    return (
      <>
        {panels.map((panel, index) => (
          <PrintsResultAction
            key={panel.printId}
            printId={panel.printId}
            pictures={
              paired
                ? pictures.slice(index, index + 1)
                : index === 0
                  ? pictures
                  : []
            }
            capabilities={capabilities}
          />
        ))}
      </>
    );
  }
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
