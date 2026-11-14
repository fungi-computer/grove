import type { AppAgentInstructions } from "@fungi.computer/agar";
import { Button } from "@fungi.computer/caps/components/button";
import { ConfirmAction } from "@fungi.computer/caps/components/confirm-action";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@fungi.computer/caps/components/tooltip";
import { NotebookPen } from "lucide-react";
import { useId, useState } from "react";

/** How a save ended; the control words each for the owner. */
export type InstructionsSave = "saved" | "conflict" | "too_large" | "failed";

/** What an empty editor suggests; it is a placeholder, never saved text. */
function starterTemplate(name: string): string {
  return `# ${name}'s instructions\n\nWrite what ${name} should do in every conversation, in plain language.\n\n- Keep replies short.\n`;
}

const utf8 = new TextEncoder();
const number = (value: number) => value.toLocaleString("en-US");
/** The counter appears once a draft is this close to the limit. */
const counterFromShare = 0.8;
const noHomeTooltip =
  "No Home Computer. An Agent gets one when it is created with a Computer; with several, choose one in a conversation with /home <name>.";

/**
 * Owner-only editor for the AGENTS.md on the selected Agent's Home Computer.
 * The file is the only copy: the Agent reads it each run and can edit it too,
 * so a save made over a changed file is refused and the owner reloads instead
 * of overwriting it.
 */
export function AgentInstructionsControl({
  agentId,
  name,
  file,
  loading,
  save,
  reload,
  notify,
}: {
  agentId: string;
  name: string;
  /** The file as the host read it; absent until it has been read. */
  file: AppAgentInstructions | undefined;
  loading: boolean;
  save: (
    agentId: string,
    edit: { expectedContent: string | null; content: string },
  ) => Promise<InstructionsSave>;
  /** Read the file again; rejects when the host cannot be reached. */
  reload: () => Promise<AppAgentInstructions>;
  /** A transient message in the host's toast. */
  notify: (message: string, tone: "error" | "warning") => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // What the owner last read: the base every save is checked against.
  const [base, setBase] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const fieldId = useId();
  const limit = file?.limit ?? 0;
  const bytes = utf8.encode(draft ?? "").byteLength;
  const overLimit = draft !== null && bytes > limit;
  const showCounter = overLimit || bytes >= limit * counterFromShare;
  const unchanged = draft === (base ?? "");
  const noHome = file?.home === null;
  const open = (current: AppAgentInstructions) => {
    setStale(false);
    setBase(current.content);
    setDraft(current.content ?? "");
  };
  const reloadFile = async () => {
    try {
      open(await reload());
    } catch (cause) {
      // The dialog stays as it is, with the owner's edits.
      console.error("Instructions reload failed", cause);
      notify("Couldn't reload this file. Try again.", "error");
    }
  };
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            aria-label="Instructions"
            aria-haspopup={noHome ? undefined : "dialog"}
            // Dimmed, not aria-disabled: that would stop the pointer reaching the tooltip.
            className={noHome ? "opacity-40" : undefined}
            icon={<NotebookPen size={14} aria-hidden="true" />}
            disabled={loading || file === undefined}
            onClick={() => {
              if (file === undefined) return;
              // A touch tap opens no tooltip, so say it as a toast too.
              if (noHome) notify(noHomeTooltip, "warning");
              else open(file);
            }}
          />
        </TooltipTrigger>
        <TooltipContent>
          {noHome ? noHomeTooltip : "Instructions"}
        </TooltipContent>
      </Tooltip>
      <Dialog
        open={draft !== null}
        onOpenChange={(next) => {
          if (!next && !saving) setDraft(null);
        }}
      >
        <DialogContent
          className="flex flex-col gap-lg"
          keepMounted={false}
          forceBackdrop
        >
          <DialogHeader>
            <DialogTitle>{name}'s instructions</DialogTitle>
            <DialogDescription>
              {name} follows these at the start of every conversation, and can
              update them as it learns.
            </DialogDescription>
            {file?.home ? (
              <p className="text-xs text-base-content/70">
                Saved as AGENTS.md on {file.home.name}. Other Agents that use{" "}
                {file.home.name} read it too.
              </p>
            ) : null}
          </DialogHeader>
          <div className="grid gap-xs">
            <label htmlFor={fieldId} className="text-sm font-medium">
              Instructions
            </label>
            <Textarea
              id={fieldId}
              rows={14}
              className="font-mono text-sm"
              value={draft ?? ""}
              invalid={overLimit}
              disabled={saving}
              placeholder={starterTemplate(name)}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
              }}
            />
            {showCounter ? (
              <p
                className={`text-xs ${overLimit ? "text-error" : "text-base-content/70"}`}
                role={overLimit ? "alert" : undefined}
              >
                {draft !== null && bytes !== draft.length ? "About " : ""}
                {number(bytes)} of {number(limit)} characters
                {overLimit ? ". Shorten it to save." : ""}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setDraft(null);
              }}
            >
              Cancel
            </Button>
            {stale ? (
              draft === (base ?? "") ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    void reloadFile();
                  }}
                >
                  Reload
                </Button>
              ) : (
                <ConfirmAction
                  mode="hold"
                  variant="primary"
                  label="Hold to reload"
                  confirmLabel="Hold to reload and lose your edits"
                  onConfirm={reloadFile}
                />
              )
            ) : (
              <Button
                type="button"
                variant="primary"
                loading={saving}
                disabled={saving || draft === null || overLimit || unchanged}
                onClick={() => {
                  if (draft === null) return;
                  setSaving(true);
                  void save(agentId, {
                    expectedContent: base,
                    content: draft,
                  }).then((result) => {
                    setSaving(false);
                    if (result === "saved") setDraft(null);
                    else if (result === "conflict") {
                      setStale(true);
                      notify(
                        `${name} changed this file. Reload to see it.`,
                        "warning",
                      );
                    } else
                      notify(
                        result === "too_large"
                          ? "That file is too large to save."
                          : "The instructions could not be saved. Try again.",
                        "error",
                      );
                  });
                }}
              >
                Save
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
