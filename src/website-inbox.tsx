import { messageAuthor } from "@fungi.computer/agar/agents";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { AppRoot } from "@fungi.computer/agar";
import {
  channelsRead,
  channelsPersonalManage,
  type AppWebsiteConversation,
} from "@fungi.computer/agar/channels";
import { capabilityQuery, queryKeys } from "@fungi.computer/agar/query";
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
import {
  createConversationOpeningOwner,
  type OpenConversation,
  type Services,
} from "@fungi.computer/parakeet/conversation-opening";
import { createWebsiteReplySession } from "./website-reply-session.js";

export type WebsiteInboxRow = Readonly<{
  bindingId: string;
  agentId: string;
  siteLabel: string;
  conversation: AppWebsiteConversation;
}>;

export function useWebsiteInbox(app: AppRoot | null, services: Services) {
  useSyncExternalStore(
    (notify) => app?.capabilities.subscribe(notify) ?? (() => undefined),
    () => app?.capabilities.version ?? 0,
  );
  const client = useQueryClient();
  const [selection, setSelection] = useState<Readonly<{
    bindingId: string;
    sessionId: string;
  }> | null>(null);
  const [open, setOpen] = useState<OpenConversation | null>(null);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const canRead = app?.capabilities.has(channelsRead) === true;
  const canManage = app?.capabilities.has(channelsPersonalManage) === true;
  const directory = useQuery({
    ...capabilityQuery(
      app,
      channelsRead,
      queryKeys.of(app, "websites"),
      (owner) => owner.list(),
    ),
    enabled: canRead,
  });
  const websites = canRead ? (directory.data?.websites ?? []) : [];
  const pages = useQueries({
    queries: websites.map((site) => ({
      ...capabilityQuery(
        app,
        channelsRead,
        queryKeys.of(app, "website-conversations", site.bindingId),
        (owner) => owner.conversations({ bindingId: site.bindingId }),
      ),
      enabled: canRead,
    })),
  });
  const rows: WebsiteInboxRow[] = websites
    .flatMap((site, index) =>
      (pages[index]?.data?.conversations ?? []).map((conversation) => ({
        bindingId: site.bindingId,
        agentId: site.agentId,
        siteLabel: site.origins
          .map((origin) => new URL(origin).host)
          .join(", "),
        conversation,
      })),
    )
    .sort(
      (left, right) =>
        right.conversation.lastEventAt - left.conversation.lastEventAt,
    );
  const selected = rows.find(
    (row) =>
      row.bindingId === selection?.bindingId &&
      row.conversation.sessionId === selection.sessionId,
  );
  const opening = useMemo(
    () =>
      app === null
        ? null
        : createConversationOpeningOwner({
            connection: app,
            queryClient: client,
            services,
            onPending: () => undefined,
            onConversation: setOpen,
            onError: setOpeningError,
          }),
    [app, client, services],
  );
  useEffect(
    () => () => {
      opening?.close();
    },
    [opening],
  );
  useEffect(() => {
    if (!canRead) opening?.clear();
  }, [canRead, opening]);
  const action = useMutation({
    mutationFn: (
      intent: {
        bindingId: string;
        sessionId: string;
      } & (
        | { kind: "release"; expectedVersion: number; confirm: boolean }
        | { kind: "hold"; expectedVersion: number; confirm: boolean }
      ),
    ) => {
      if (app === null) throw new Error("No App connection");
      const owner = app.capabilities.require(channelsPersonalManage);
      return intent.kind === "hold"
        ? owner.hold({
            bindingId: intent.bindingId,
            sessionId: intent.sessionId,
            expectedVersion: intent.expectedVersion,
            confirm: intent.confirm,
          })
        : owner.release({
            bindingId: intent.bindingId,
            sessionId: intent.sessionId,
            expectedVersion: intent.expectedVersion,
            confirm: intent.confirm,
          });
    },
    onSuccess: (conversation, intent) => {
      client.setQueryData<{ conversations: AppWebsiteConversation[] }>(
        queryKeys.of(app, "website-conversations", intent.bindingId),
        (previous) =>
          previous === undefined
            ? undefined
            : {
                conversations: previous.conversations.map((item) =>
                  item.sessionId === conversation.sessionId
                    ? conversation
                    : item,
                ),
              },
      );
    },
  });
  const selectedBindingId = selected?.bindingId;
  const selectedSessionId = selected?.conversation.sessionId;
  const heldByYou = selected?.conversation.heldByYou === true;
  const session = useMemo(
    () =>
      open === null ||
      selectedBindingId === undefined ||
      selectedSessionId === undefined ||
      app === null
        ? null
        : createWebsiteReplySession(open.session, {
            bindingId: selectedBindingId,
            sessionId: selectedSessionId,
            canReply: () =>
              heldByYou && app.capabilities.has(channelsPersonalManage),
            reply: (input) =>
              app.capabilities.require(channelsPersonalManage).reply(input),
          }),
    [app, open, selectedBindingId, selectedSessionId, heldByYou],
  );
  const clear = useCallback(() => {
    opening?.clear();
    setSelection(null);
    setOpen(null);
    action.reset();
  }, [opening, action.reset]);
  return {
    canRead,
    canManage,
    rows,
    selected,
    session,
    action,
    openingError,
    loading:
      canRead && (directory.isPending || pages.some((page) => page.isPending)),
    failed:
      canRead && (directory.isError || pages.some((page) => page.isError)),
    clear,
    select: (row: WebsiteInboxRow) => {
      if (!canRead) return;
      if (
        selected?.bindingId === row.bindingId &&
        selected.conversation.sessionId === row.conversation.sessionId &&
        open !== null
      )
        return;
      setSelection({
        bindingId: row.bindingId,
        sessionId: row.conversation.sessionId,
      });
      setOpen(null);
      action.reset();
      opening?.select(row.agentId, row.conversation.sessionId);
    },
  };
}

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
