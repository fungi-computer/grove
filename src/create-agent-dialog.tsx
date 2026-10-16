import { useRef, type RefObject } from "react";
import type { AppAgentCreateInput } from "@fungi.computer/agar/agents";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@fungi.computer/caps/components/dialog";
import { CreateAgentForm } from "./create-agent-form.js";

export function CreateAgentDialog({
  open,
  pending,
  error,
  canChooseComputer,
  create,
  onClose,
  returnFocus,
}: {
  open: boolean;
  pending: boolean;
  error: string | null;
  canChooseComputer: boolean;
  create: (intent: AppAgentCreateInput) => Promise<boolean>;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement>;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent
        className="flex flex-col gap-lg"
        initialFocus={input}
        finalFocus={returnFocus}
        keepMounted={false}
      >
        <DialogHeader>
          <DialogTitle>New Agent</DialogTitle>
          <DialogDescription>
            Agents chat, write and make little games with you.
          </DialogDescription>
        </DialogHeader>
        <CreateAgentForm
          create={create}
          canChooseComputer={canChooseComputer}
          inputRef={input}
          error={error}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
