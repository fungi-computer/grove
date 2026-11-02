import { useRef, type RefObject } from "react";
import type {
  AppAgentComputerChoice,
  AppAgentCreateInput,
} from "@fungi.computer/agar/agents";
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
  computers,
  create,
  onClose,
  returnFocus,
}: {
  open: boolean;
  pending: boolean;
  error: string | null;
  /**
   * The Team's Computers for the picker: loading, offered (newest first),
   * not offered by this host, or unreadable.
   */
  computers:
    | { status: "loading" }
    | { status: "offered"; computers: readonly AppAgentComputerChoice[] }
    | { status: "not-offered" }
    | { status: "unavailable"; message: string };
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
        {computers.status === "loading" ? (
          <p role="status">Loading your Computers…</p>
        ) : (
          <CreateAgentForm
            create={create}
            computers={
              computers.status === "offered"
                ? computers.computers
                : computers.status === "unavailable"
                  ? []
                  : null
            }
            computersUnavailable={
              computers.status === "unavailable" ? computers.message : null
            }
            inputRef={input}
            error={error}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
