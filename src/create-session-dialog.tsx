import { useMemo, type RefObject } from "react";
import { Schema } from "effect";
import type { AppAgent } from "@fungi.computer/agar/agents";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@fungi.computer/caps/components/dialog";
import { Button } from "@fungi.computer/caps/components/button";
import { FormFooter } from "@fungi.computer/caps/components/field";
import {
  SchemaForm,
  field,
  useSchemaForm,
  useSchemaFormStatus,
} from "@fungi.computer/caps/form";
import { agentLabel } from "./inbox-model.js";

export function CreateSessionDialog({
  open,
  agents,
  defaultAgentId,
  start,
  pending,
  onClose,
  onNewAgent,
  returnFocus,
}: {
  open: boolean;
  agents: readonly AppAgent[];
  defaultAgentId: string | null;
  start: (agentId: string) => Promise<string | undefined>;
  pending: boolean;
  onClose: () => void;
  onNewAgent?: () => void;
  returnFocus: RefObject<HTMLElement>;
}) {
  const schema = useMemo(
    () =>
      Schema.Struct({
        agentId: Schema.String.check(
          Schema.makeFilter<string>(
            (value) =>
              agents.some((agent) => agent.agentId === value) ||
              "Choose an Agent.",
          ),
        ).annotate(
          field({
            label: "Agent",
            kind: "select",
            options: Object.fromEntries(
              agents.map((agent) => [agent.agentId, agentLabel(agent)]),
            ),
          }),
        ),
      }),
    [agents],
  );
  const model = useSchemaForm({
    schema,
    defaultValues: { agentId: defaultAgentId ?? "" },
    onSubmit: async ({ agentId }) => {
      const error = await start(agentId);
      if (error) return { kind: "refused", error };
      return undefined;
    },
  });
  const { submitting, canSubmit } = useSchemaFormStatus(model);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending && !model.form.state.isSubmitting) onClose();
      }}
    >
      <DialogContent
        className="flex flex-col gap-lg"
        keepMounted={false}
        finalFocus={returnFocus}
      >
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>Choose who to talk with.</DialogDescription>
        </DialogHeader>
        {agents.length === 0 ? (
          <div className="grid gap-sm">
            <p>No Agent has conversation access yet.</p>
            {onNewAgent ? (
              <Button onClick={onNewAgent}>New Agent</Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        ) : (
          <SchemaForm
            model={model}
            aria-label="New conversation"
            footer={
              <FormFooter divider={false} error={model.error}>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={submitting || pending}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={submitting || pending}
                  disabled={!canSubmit || submitting || pending}
                >
                  Start
                </Button>
              </FormFooter>
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
