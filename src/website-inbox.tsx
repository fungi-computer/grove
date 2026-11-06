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
