import { useEffect, useState } from "react";
import { messageAuthor } from "@fungi.computer/agar/agents";
import { Button } from "@fungi.computer/caps/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@fungi.computer/caps/components/dialog";
import { Parakeet } from "@fungi.computer/parakeet";
import type { useWebsiteInbox } from "./website-inbox.js";

export function WebsiteConversation({
  inbox,
}: {
  inbox: ReturnType<typeof useWebsiteInbox>;
}) {
  const { selected, session, action, canManage, openingError } = inbox;
  const [confirmation, setConfirmation] = useState<Readonly<{
    bindingId: string;
    sessionId: string;
    version: number;
    name: string;
  }> | null>(null);
  useEffect(() => {
    setConfirmation(null);
  }, [selected?.bindingId, selected?.conversation.sessionId, canManage]);
  if (selected === undefined) return null;
  const conversation = selected.conversation;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Website conversation"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-base-300 p-2">
        <span className="min-w-0 flex-1 text-sm">
          {conversation.heldByYou
            ? "You're replying. The Agent is paused."
            : conversation.held
              ? `${conversation.heldByName ?? "A teammate"} is replying.`
              : "The Agent is replying. Take over to answer as yourself."}
        </span>
        {canManage ? (
          <Button
            size="sm"
            disabled={action.isPending}
            onClick={() => {
              const target = {
                bindingId: selected.bindingId,
                sessionId: conversation.sessionId,
              };
              if (conversation.heldByYou)
                action.mutate({
                  kind: "release",
                  ...target,
                  expectedVersion: conversation.holdVersion,
                  confirm: false,
                });
              else if (conversation.held)
                setConfirmation({
                  ...target,
                  version: conversation.holdVersion,
                  name: conversation.heldByName ?? "A teammate",
                });
              else
                action.mutate({
                  kind: "hold",
                  ...target,
                  expectedVersion: conversation.holdVersion,
                  confirm: false,
                });
            }}
          >
            {conversation.heldByYou ? "Hand back to Agent" : "Take over"}
          </Button>
        ) : null}
      </div>
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmation?.name} is replying — take over?
            </DialogTitle>
            <DialogDescription>
              You will reply as yourself. Their replies stop until they take
              over again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              disabled={action.isPending || !canManage}
              onClick={() => {
                if (confirmation === null) return;
                action.mutate({
                  kind: "hold",
                  bindingId: confirmation.bindingId,
                  sessionId: confirmation.sessionId,
                  expectedVersion: confirmation.version,
                  confirm: true,
                });
                setConfirmation(null);
              }}
            >
              Take over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!canManage ? (
        <p className="p-3 text-sm">
          Allow takeover in Grove's App permissions to reply. Your Team
          permissions still apply.
        </p>
      ) : null}
      {action.isError ? (
        <p role="alert" className="p-2 text-sm text-error">
          This conversation changed or website access was removed. Refresh and
          try again.
        </p>
      ) : null}
      {openingError ? (
        <p role="alert" className="p-2 text-sm text-error">
          {openingError}
        </p>
      ) : null}
      {session ? (
        <div className="min-h-0 flex-1">
          <Parakeet
            authorOf={messageAuthor}
            disambiguateAuthors
            key={`${selected.bindingId}:${conversation.sessionId}`}
            session={session}
            markdownPolicy="visitor"
            composerActionVariant="outline"
          />
        </div>
      ) : null}
    </section>
  );
}
