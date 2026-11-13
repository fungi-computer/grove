import { appAgentInstructionsMaxLength } from "@fungi.computer/agar";
import { Button } from "@fungi.computer/caps/components/button";
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
import { NotebookPen } from "lucide-react";
import { useId, useState } from "react";

/**
 * Owner-only standing instructions for the selected Agent. One small icon
 * opens a plain text box; what the owner writes is added after the host's own
 * instructions and followed on every turn. It cannot replace them.
 */
export function AgentInstructionsControl({
  agentId,
  name,
  instructions,
  loading,
  save,
}: {
  agentId: string;
  name: string;
  /** What the host stores now; absent until it has been read. */
  instructions: string | undefined;
  loading: boolean;
  save: (agentId: string, instructions: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const fieldId = useId();
  const overBound =
    draft !== null && draft.length > appAgentInstructionsMaxLength;
  return (
    <>
      <IconButton
        aria-label="Agent instructions"
        aria-haspopup="dialog"
        icon={<NotebookPen size={14} aria-hidden="true" />}
        disabled={loading || instructions === undefined}
        onClick={() => {
          setFailed(false);
          setDraft(instructions ?? "");
        }}
      />
      <Dialog
        open={draft !== null}
        onOpenChange={(next) => {
          if (!next && !saving) setDraft(null);
        }}
      >
        <DialogContent className="flex flex-col gap-lg" keepMounted={false}>
          <DialogHeader>
            <DialogTitle>{name}'s instructions</DialogTitle>
            <DialogDescription>
              Tell {name} what to do in every conversation. These come after{" "}
              {name}'s built-in instructions and never replace them.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-xs">
            <label htmlFor={fieldId} className="text-sm font-medium">
              Standing instructions
            </label>
            <Textarea
              id={fieldId}
              rows={8}
              value={draft ?? ""}
              invalid={overBound}
              disabled={saving}
              placeholder="Answer in plain language. Keep replies short."
              onChange={(event) => {
                setDraft(event.currentTarget.value);
              }}
            />
            <p
              className="text-xs"
              role={overBound || failed ? "alert" : undefined}
            >
              {failed
                ? "The instructions could not be saved. Try again."
                : overBound
                  ? `Use at most ${String(appAgentInstructionsMaxLength)} characters.`
                  : `${String(draft?.length ?? 0)} of ${String(appAgentInstructionsMaxLength)} characters`}
            </p>
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
            <Button
              type="button"
              variant="primary"
              loading={saving}
              disabled={saving || draft === null || overBound}
              onClick={() => {
                if (draft === null) return;
                setSaving(true);
                setFailed(false);
                void save(agentId, draft).then((saved) => {
                  setSaving(false);
                  if (saved) setDraft(null);
                  else setFailed(true);
                });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
