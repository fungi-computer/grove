import type { MemberInboxSession } from "@fungi.computer/agar/inbox";
import { Alert } from "@fungi.computer/caps/components/alert";
import { DataListHeading } from "@fungi.computer/caps/components/data-list";
import { CardTitle } from "@fungi.computer/caps/components/card";
import { AgentRail } from "./agent-rail.js";
import { TeamNotices } from "./team-notices.js";
import { NavigationRails, useNavigationDesktop } from "./navigation-rails.js";
import { computerList } from "@fungi.computer/agar/computer";
import { CreateAgentDialog } from "./create-agent-dialog.js";
import { CreateSessionDialog } from "./create-session-dialog.js";
import { RouterProvider } from "@tanstack/react-router";
import {
  createInboxRouter,
  InboxRouteContent,
  useInboxNavigation,
  type InboxRouter,
} from "./navigation.js";
import {
  agentLabel,
  buildInboxView,
  type InboxOpenSessionState,
} from "./inbox-model.js";
import {
  agentManage,
  agentList,
  agentRename,
  agentSessionWrite,
  openAppAgent,
  type AppAgent,
  type AppAgentCreateInput,
} from "@fungi.computer/agar/agents";
import { RenameAgentControl } from "./rename-agent-control.js";
import { AllowAppToolsControl } from "./allow-app-tools-control.js";
import type { AgentAccessOperation, AppRoot } from "@fungi.computer/agar";
import { useGroveCommands } from "./grove-commands.js";
import { createWhistle } from "@fungi.computer/whistle";
import type { RowV1 } from "@fungi.computer/gills";
import { defineIdFamily } from "@fungi.computer/cairn/id";
import type { ParakeetSession } from "@fungi.computer/parakeet";
import { ShiitakeAvatar } from "@fungi.computer/parakeet";
import {
  contributeSessionCommands,
  sessionQueryOptions,
  sessionViewState,
  type ParakeetCommandRuntime,
} from "@fungi.computer/parakeet/headless";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useAppContext, useWindowStatus } from "@fungi.computer/agar/react";
import { queryKeys } from "@fungi.computer/agar/query";
import { useInboxData, useAgentToolPolicy } from "./queries.js";
import { createShiitakeClient } from "@fungi.computer/shiitake/client";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@fungi.computer/caps/components/button";
import { ResizeHandle } from "@fungi.computer/caps/components/resize-handle";
import { usePointerDrag } from "@fungi.computer/maosaico";
import {
  clampListWidth,
  listWidthBounds,
  useGroveLayout,
} from "./grove-layout.js";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { ChevronRight, SquarePen, X } from "lucide-react";
import { ScrollArea } from "@fungi.computer/caps/components/scroll-area";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { InboxList } from "./inbox-list.js";
import { useWebsiteInbox, WebsiteConversation } from "./website-inbox.js";
import { Sigil } from "@fungi.computer/sigils";
import {
  createConversationOpeningOwner,
  eventSourceFor,
  type InboxClient,
  type OpenConversation,
  type PendingSelection,
} from "./conversation-opening.js";

const ParakeetConversation = lazy(async () => {
  const module = await import("./parakeet-conversation.js");
  return { default: module.ParakeetConversation };
});

export type InboxServices = Readonly<{
  openAgent: typeof openAppAgent;
  createClient: (
    options: Parameters<typeof createShiitakeClient>[0],
  ) => InboxClient;
  renderConversation?: (
    open: OpenConversation,
    composeDraft: Readonly<{ requestId: string; text: string }> | null,
    onOpen: (target: NonNullable<RowV1["open"]>) => void,
  ) => React.ReactNode;
}>;

const defaultServices: InboxServices = {
  openAgent: openAppAgent,
  createClient: createShiitakeClient,
};

/** Grove asks its host for these; the host bounds and grants them. */
const groveAgentAccess: readonly AgentAccessOperation[] = [
  "agent.list",
  "agent.manage",
  "agent.read",
  "agent.send",
];
const conversationAccess: readonly AgentAccessOperation[] = [
  "agent.read",
  "agent.send",
  "agent.manage",
];

const sessionCreateRequests = defineIdFamily({
  family: "grove-session-create-request",
  version: 1,
  kinds: { request: { prefix: "request" } },
});

async function withAgentClient<T>(
  app: AppRoot,
  agentId: string,
  services: InboxServices,
  work: (client: InboxClient) => Promise<T>,
): Promise<T> {
  const transport = await services.openAgent(app.capabilities, { agentId });
  const client = services.createClient({
    baseUrl: transport.baseUrl,
    eventSource: eventSourceFor(transport.fetch),
    fetch: transport.fetch,
  });
  try {
    return await work(client);
  } finally {
    // Closing a remote Agent capability can remain pending while its host
    // finishes cancelling a request. Do not keep the user's completed action
    // (notably creating a Session) in a loading state for transport cleanup.
    void Promise.allSettled([client.close(), transport.close()]);
  }
}

function Conversation({
  open,
  renderConversation,
  connection,
  commands,
  composeDraft,
  onPrefilled,
  onForked,
  onOpen,
  label = "Conversation",
}: {
  connection: AppRoot | null;
  commands: ParakeetCommandRuntime;
  open: OpenConversation;
  renderConversation?: InboxServices["renderConversation"];
  composeDraft: Readonly<{ requestId: string; text: string }> | null;
  onPrefilled: () => void;
  onForked: (sessionId: string) => void;
  onOpen: (target: NonNullable<RowV1["open"]>) => void;
  label?: string;
}): React.JSX.Element {
  const session: ParakeetSession = open.session;
  useEffect(() => {
    // Each pane has its own command runtime, so this source never collides.
    const lease = contributeSessionCommands(commands, session, {
      sourceId: "grove-session",
      namespace: "session",
      sessionResumeAvailable: false,
      forkAvailable: true,
      onForked,
    });
    return () => {
      lease.dispose();
    };
  }, [commands, session, onForked]);
  return (
    <section
      className="inbox-conversation min-h-0 min-w-0 flex-1"
      data-inbox-conversation
      aria-label={label}
    >
      {renderConversation ? (
        renderConversation(open, composeDraft, onOpen)
      ) : (
        <Suspense
          fallback={
            <p className="p-3 text-sm text-(--stipe-fg-muted)" role="status">
              Opening conversation…
            </p>
          }
        >
          <ParakeetConversation
            session={session}
            connection={connection}
            commands={commands}
            prefill={composeDraft}
            onPrefilled={onPrefilled}
            onOpen={onOpen}
          />
        </Suspense>
      )}
    </section>
  );
}

export type InboxProps = {
  connection: AppRoot | null;
  services?: InboxServices;
};

export function InboxApp(props: InboxProps): React.JSX.Element {
  useAppContext(props.connection);
  return (
    <RoutedInbox
      key={JSON.stringify(queryKeys.of(props.connection))}
      {...props}
    />
  );
}

function RoutedInbox(props: InboxProps): React.JSX.Element {
  const router = useMemo(createInboxRouter, [props.connection]);
  return (
    <InboxRouteContent value={<ConnectedInbox {...props} router={router} />}>
      <RouterProvider router={router} />
    </InboxRouteContent>
  );
}

function ConnectedInbox({
  router,
  connection,
  services = defaultServices,
}: InboxProps & { router: InboxRouter }): React.JSX.Element {
  const {
    agentFilterId,
    setFilter: setAgentFilterId,
    selection,
    open: navigateSession,
  } = useInboxNavigation(router, connection?.window.navigation);
  const queryClient = useQueryClient();
  const websites = useWebsiteInbox(connection, services);
  const {
    directory,
    inbox,
    createAgent: createAgentMutation,
    renameAgent: renameAgentMutation,
  } = useInboxData(connection);
  const agents = directory.data ?? [];
  const directoryLoading =
    directory.isPending && (connection?.capabilities.has(agentList) ?? true);
  const error = directory.error?.message ?? null;
  const creatingAgent = createAgentMutation.isPending;
  const startMutation = useMutation({
    mutationFn: (intent: { agentId: string; requestId: string }) => {
      if (!connection) throw new Error("No App connection");
      return withAgentClient(connection, intent.agentId, services, (client) =>
        client.createSession(intent.requestId),
      );
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (target: { agentId: string; sessionId: string }) => {
      if (!connection) throw new Error("No App connection");
      return withAgentClient(connection, target.agentId, services, (client) =>
        client.deleteSession(target.sessionId),
      );
    },
    onSuccess: (_deleted, target) => {
      if (
        selection?.agentId === target.agentId &&
        selection.sessionId === target.sessionId
      ) {
        conversationOpener?.clear();
        void router.navigate({ to: "/", search: true, replace: true });
      }
      inbox.refresh();
    },
  });
  const startingAgentId = startMutation.isPending
    ? startMutation.variables.agentId
    : null;
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const [openConversation, setOpenConversation] =
    useState<OpenConversation | null>(null);
  const [websitesOnly, setWebsitesOnly] = useState(false);
  const selectedAgentId = openConversation?.agentId ?? null;
  const selectedSessionId = openConversation?.sessionId ?? null;
  const [creation, setCreation] = useState<"agent" | "session" | null>(null);
  const dialogReturnFocus = useRef<HTMLElement | null>(null);
  const [layout, setLayout] = useGroveLayout();
  const { agentRailOpen, listRailOpen, listWidth } = layout;
  const setAgentRailOpen = (open: (current: boolean) => boolean) => {
    setLayout((current) => ({
      ...current,
      agentRailOpen: open(current.agentRailOpen),
    }));
  };
  const setListRailOpen = (open: (current: boolean) => boolean) => {
    setLayout((current) => ({
      ...current,
      listRailOpen: open(current.listRailOpen),
    }));
  };
  const setListWidth = (width: (current: number) => number) => {
    setLayout((current) => ({
      ...current,
      listWidth: clampListWidth(width(current.listWidth)),
    }));
  };
  // Maosaico's captured-pointer gesture drives the Caps grip; no new splitter.
  const listResize = usePointerDrag({
    begin: () => true,
    move: (dx) => {
      setListWidth((width) => width + dx);
    },
    end: () => undefined,
  });
  const [navOpen, setNavOpen] = useState(false);
  const desktop = useNavigationDesktop();
  const navigationReturnFocus = useRef<HTMLElement | null>(null);

  const [startAgentId, setStartAgentId] = useState<string | null>(null);
  const agentCreationError = createAgentMutation.error?.message ?? null;
  const createdAgent = createAgentMutation.data;
  const sessionCreateIntent = useRef<Readonly<{
    agentId: string;
    requestId: string;
  }> | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(
    null,
  );
  const [composeDraft, setComposeDraft] = useState<Readonly<{
    requestId: string;
    text: string;
  }> | null>(null);
  const openRequest = useAppContext(connection)?.openRequest ?? null;
  const handledOpenRequestId = useRef<string | null>(null);
  const conversationOpener = useMemo(
    () =>
      connection === null
        ? null
        : createConversationOpeningOwner({
            connection,
            queryClient,
            services,
            onPending: setPendingSelection,
            onConversation: setOpenConversation,
            onError: setConversationError,
          }),
    [connection, queryClient, services],
  );

  useEffect(() => {
    if (conversationOpener === null) return;
    return () => {
      sessionCreateIntent.current = null;
      conversationOpener.close();
    };
  }, [conversationOpener]);

  // A footer row (a sub-agent) opens beside the selected conversation, with
  // its own opener and command runtime; the route keeps the primary one.
  const [besideConversation, setBesideConversation] =
    useState<OpenConversation | null>(null);
  const besideRuntime = useMemo(() => createWhistle(), []);
  const besideOpener = useMemo(
    () =>
      connection === null
        ? null
        : createConversationOpeningOwner({
            connection,
            queryClient,
            services,
            onPending: () => undefined,
            onConversation: setBesideConversation,
            onError: setConversationError,
            reportsSelection: false,
          }),
    [connection, queryClient, services],
  );
  useEffect(
    () =>
      besideOpener === null
        ? undefined
        : () => {
            besideOpener.close();
          },
    [besideOpener],
  );
  const openBeside = useCallback(
    (target: NonNullable<RowV1["open"]>) => {
      const param = (key: string) =>
        target.params.find((entry) => entry.key === key)?.value;
      const agentId = param("agent");
      const sessionId = param("session");
      if (agentId === undefined || sessionId === undefined) return;
      besideOpener?.select(agentId, sessionId, false, false);
    },
    [besideOpener],
  );

  // Row/host requests start immediately. Consume their route publication once
  // so a failed baseline is not retried by the router's later render.
  const initiatedSelection = useRef<PendingSelection | null>(null);
  const selectSession = useCallback(
    (
      agentId: string,
      sessionId: string,
      fromOpenRequest = false,
      waitForBaseline = true,
    ): void => {
      if (conversationOpener === null) return;
      if (startMutation.isError) startMutation.reset();
      websites.clear();
      setWebsitesOnly(false);
      initiatedSelection.current = { agentId, sessionId };
      conversationOpener.select(
        agentId,
        sessionId,
        fromOpenRequest,
        waitForBaseline,
      );
      navigateSession(agentId, sessionId);
    },
    [
      conversationOpener,
      navigateSession,
      websites.clear,
      startMutation.isError,
      startMutation.reset,
    ],
  );

  const routeAgentId = selection?.agentId;
  const routeSessionId = selection?.sessionId;
  useEffect(() => {
    const initiated = initiatedSelection.current;
    initiatedSelection.current = null;
    if (routeAgentId === undefined || routeSessionId === undefined) {
      conversationOpener?.clear();
    } else if (
      initiated?.agentId !== routeAgentId ||
      initiated.sessionId !== routeSessionId
    ) {
      conversationOpener?.select(routeAgentId, routeSessionId);
    }
  }, [conversationOpener, routeAgentId, routeSessionId]);

  const onForked = useCallback(
    (sessionId: string): void => {
      if (!openConversation) return;
      selectSession(openConversation.agentId, sessionId, false, false);
      // The forked Session is new; reload the owner snapshot so its row
      // appears without waiting for the visibility feed's own delta.
      inbox.refresh();
    },
    [openConversation, selectSession, inbox.refresh],
  );

  useEffect(() => {
    if (!connection || openRequest === null) {
      if (openRequest === null) handledOpenRequestId.current = null;
      return;
    }
    if (openRequest.kind !== "navigate") return;
    if (handledOpenRequestId.current === openRequest.requestId) return;
    const agentId = openRequest.params.find(
      (param) => param.key === "agent",
    )?.value;
    const sessionId = openRequest.params.find(
      (param) => param.key === "session",
    )?.value;
    if (!agentId || !sessionId) return;
    handledOpenRequestId.current = openRequest.requestId;
    setAgentFilterId(agentId);
    selectSession(agentId, sessionId, true);
  }, [connection, openRequest, selectSession, setAgentFilterId]);

  const createAgent = useCallback(
    async (intent: AppAgentCreateInput): Promise<boolean> => {
      if (
        !connection ||
        creatingAgent ||
        !connection.capabilities.has(agentManage)
      )
        return false;
      try {
        const agent = await createAgentMutation.mutateAsync(intent);
        setAgentFilterId(agent.agentId);
        setStartAgentId(agent.agentId);
        setCreation(null);
        return true;
      } catch {
        // The Query mutation owns the error shown in the dialog footer.
        return false;
      }
    },
    [
      connection,
      creatingAgent,
      createAgentMutation.mutateAsync,
      setAgentFilterId,
    ],
  );

  const startConversation = useCallback(
    async (agentId: string) => {
      if (!connection || startingAgentId !== null)
        return "Conversation creation is unavailable.";
      setConversationError(null);
      const intent =
        sessionCreateIntent.current?.agentId === agentId
          ? sessionCreateIntent.current
          : {
              agentId,
              requestId: sessionCreateRequests.request.generate(),
            };
      sessionCreateIntent.current = intent;
      try {
        const sessionId = await startMutation.mutateAsync(intent);
        // The loaded member inbox owns the new row and resumes its feed.
        selectSession(agentId, sessionId, false, false);
        // Session creation can beat this App's visibility feed delta. Reload
        // the owner snapshot without delaying the new conversation opening.
        inbox.refresh();
        setCreation(null);
        setNavOpen(false);
        if (sessionCreateIntent.current === intent)
          sessionCreateIntent.current = null;
        return undefined;
      } catch (cause: unknown) {
        console.error("Grove conversation creation failed", cause);
        return cause instanceof Error
          ? cause.message
          : "Couldn't start the conversation.";
      }
    },
    [
      connection,
      selectSession,
      startingAgentId,
      startMutation.mutateAsync,
      inbox.refresh,
    ],
  );

  useEffect(() => {
    if (!connection || openRequest?.kind !== "compose") return;
    if (handledOpenRequestId.current === openRequest.requestId) return;
    if (!openConversation && directoryLoading) return;
    handledOpenRequestId.current = openRequest.requestId;
    setComposeDraft({
      requestId: openRequest.requestId,
      text: openRequest.text,
    });
    if (!openConversation) {
      const agent = connection.capabilities.has(agentSessionWrite)
        ? agents.find(
            (item) =>
              item.sessionOperations.includes("agent.read") &&
              item.sessionOperations.includes("agent.send") &&
              item.sessionOperations.includes("agent.manage"),
          )
        : undefined;
      if (agent) void startConversation(agent.agentId);
      else {
        setCreation("agent");
      }
    }
  }, [
    agents,
    connection,
    directoryLoading,
    openConversation,
    openRequest,
    startConversation,
  ]);

  const groveRuntime = useGroveCommands(
    {
      newConversation: () => {
        if (openConversation) void startConversation(openConversation.agentId);
      },
      openPermissions: () => {
        // An empty request opens this App's permissions in the host.
        void connection?.ui
          .requestAppPermissions({})
          .catch((cause: unknown) => {
            console.error("Chat inbox or permission request failed", cause);
            return undefined;
          });
      },
    },
    connection?.commands,
  );

  const websiteSessionIds = new Set(
    websites.rows.map((row) => `${row.agentId}:${row.conversation.sessionId}`),
  );
  const sessions = inbox.items
    .filter((row): row is MemberInboxSession => !("kind" in row))
    .filter((row) => !websiteSessionIds.has(`${row.agentId}:${row.sessionId}`));
  // Borrow the conversation's query without starting a second Session watch.
  const openProjection = useQueries({
    queries: (openConversation ? [openConversation.session] : []).map(
      (session) => ({ ...sessionQueryOptions(session), enabled: false }),
    ),
  }).at(0);
  // Opening already seeded this query with the owner's read. Use that baseline
  // before the watch opens so the list reserves the correct initial shelf.
  const openSnapshot = openProjection?.data?.snapshot;
  const openState = useMemo<InboxOpenSessionState | undefined>(
    () =>
      openConversation && openSnapshot
        ? {
            agentId: openConversation.agentId,
            sessionId: openConversation.sessionId,
            state: sessionViewState(openSnapshot),
          }
        : undefined,
    [openConversation, openSnapshot],
  );
  const view = useMemo(
    () =>
      buildInboxView(
        agents,
        websitesOnly && websites.canRead ? [] : sessions,
        agentFilterId,
        openState,
      ),
    [
      agentFilterId,
      agents,
      sessions,
      websitesOnly,
      websites.canRead,
      openState,
    ],
  );
  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.agentId, agent])),
    [agents],
  );
  const listViewport = useRef<HTMLDivElement>(null);
  // Session creation can beat the member projection. Record a visit only
  // once that row exists, and again when it settles while open. Visit updates
  // do not change settledAt, so the owner's acknowledgement cannot loop.
  const openRow = sessions.find(
    (session) =>
      session.agentId === selectedAgentId &&
      session.sessionId === selectedSessionId,
  );
  const openRowAvailable =
    openRow !== undefined && openRow.state !== "unavailable";
  const openSettledAt =
    openRow !== undefined && openRow.state !== "unavailable"
      ? openRow.settledAt
      : undefined;
  useEffect(() => {
    if (
      !openRowAvailable ||
      selectedAgentId === null ||
      selectedSessionId === null
    )
      return;
    void inbox
      .visit(selectedAgentId, selectedSessionId)
      .catch((cause: unknown) => {
        console.error("Chat inbox or permission request failed", cause);
        return undefined;
      });
  }, [
    openRowAvailable,
    openSettledAt,
    selectedAgentId,
    selectedSessionId,
    inbox.visit,
  ]);
  const loadingSessions = inbox.status === "loading";
  const inboxFailed = inbox.status === "error";
  const canCreateAgent = connection?.capabilities.has(agentManage) ?? false;
  const canWriteAgent =
    connection?.capabilities.has(agentSessionWrite) ?? false;
  const conversationAgents = agents.filter(
    (agent) =>
      agent.sessionOperations.includes("agent.read") &&
      agent.sessionOperations.includes("agent.send") &&
      agent.sessionOperations.includes("agent.manage"),
  );
  const startAgent: AppAgent | undefined =
    conversationAgents.find(
      (agent) => agent.agentId === (startAgentId ?? agentFilterId),
    ) ?? conversationAgents.at(0);
  const canStart = canWriteAgent && startAgent !== undefined;
  const requestAgentAccess = () => {
    void connection?.ui
      .requestAppPermissions({ agents: groveAgentAccess })
      .catch((cause: unknown) => {
        console.error("Chat inbox or permission request failed", cause);
      });
  };
  const agentNotice =
    createdAgent &&
    (!createdAgent.sessionOperations.includes("agent.read") ||
      !createdAgent.sessionOperations.includes("agent.send") ||
      !createdAgent.sessionOperations.includes("agent.manage"))
      ? "Agent created. Allow Grove to read, send messages and manage its sessions to start a conversation."
      : composeDraft &&
          !openConversation &&
          !canStart &&
          createAgentMutation.isIdle
        ? "Choose an Agent to compose your game idea."
        : null;

  // "All Agents" opens the latest activity across every Agent's rows; the
  // list itself follows the rail filter.
  const allView = useMemo(
    () => buildInboxView(agents, sessions, null, openState),
    [agents, sessions, openState],
  );
  const openListRow = (agentId: string, sessionId: string) => {
    setNavOpen(false);
    selectSession(agentId, sessionId);
  };
  useWindowStatus(
    connection,
    desktop
      ? [
          {
            kind: "button",
            id: "agents",
            text: "Agents",
            expanded: agentRailOpen,
            title: agentRailOpen ? "Hide Agents" : "Show Agents",
          },
          {
            kind: "button",
            id: "conversations",
            text: "Conversations",
            expanded: listRailOpen,
            title: listRailOpen ? "Hide conversations" : "Show conversations",
          },
        ]
      : [
          {
            kind: "button",
            id: "agents",
            text: "Agents and conversations",
            opens: "dialog",
            expanded: navOpen,
          },
        ],
    (action) => {
      if (creation !== null) return false;
      if (desktop && action.itemId === "agents") {
        setAgentRailOpen((open) => !open);
      } else if (desktop && action.itemId === "conversations") {
        setListRailOpen((open) => !open);
      } else if (!desktop && action.itemId === "agents") {
        if (!navOpen)
          navigationReturnFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        setNavOpen((open) => !open);
      } else return false;
      return true;
    },
  );
  const openLatest = (agentId: string) => {
    setAgentFilterId(agentId);
    setStartAgentId(agentId);
    const latest = [...allView.active, ...allView.settled]
      .filter((row) => row.agentId === agentId)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .at(0);
    if (latest) openListRow(agentId, latest.sessionId);
  };
  const listWidthStyle: React.CSSProperties & {
    "--grove-list-width": string;
  } = { "--grove-list-width": `${String(listWidth)}px` };
  const openAgent = openConversation
    ? agentById.get(openConversation.agentId)
    : undefined;
  const besideAgent = besideConversation
    ? agentById.get(besideConversation.agentId)
    : undefined;
  const canRenameAgent = connection?.capabilities.has(agentRename) ?? false;
  const toolPolicy = useAgentToolPolicy(connection, openAgent?.agentId ?? null);
  const openTitle =
    openRow !== undefined && openRow.state !== "unavailable"
      ? openRow.title || "Untitled conversation"
      : "Conversation";
  const facetAgent =
    agentFilterId === null ? undefined : agentById.get(agentFilterId);
  const listed = view.active.length + view.settled.length;
  const renameAgent = useCallback(
    async (agentId: string, name: string): Promise<boolean> => {
      if (!connection) return false;
      try {
        await renameAgentMutation.mutateAsync({ agentId, name });
        return true;
      } catch {
        // The form presents its own refused state below the field.
        return false;
      }
    },
    [connection, renameAgentMutation.mutateAsync],
  );
  const approveAgentTools = useCallback(() => {
    const status = toolPolicy.status.data;
    if (!openAgent || status === undefined || status === null) return;
    toolPolicy.approve.mutate({
      agentId: openAgent.agentId,
      expectedRevision: status.revision,
    });
  }, [openAgent, toolPolicy.status.data, toolPolicy.approve]);

  const openCreation = useCallback(
    (kind: "agent" | "session") => {
      if (
        !connection ||
        creatingAgent ||
        startingAgentId !== null ||
        (kind === "agent" && !canCreateAgent)
      )
        return;
      // Swapping dialogs keeps the original trigger, not a field about to unmount.
      if (creation === null)
        dialogReturnFocus.current = navOpen
          ? navigationReturnFocus.current
          : document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      setNavOpen(false);
      if (kind === "session")
        setStartAgentId(
          openAgent?.agentId ??
            agentFilterId ??
            conversationAgents.at(0)?.agentId ??
            null,
        );
      setCreation(kind);
    },
    [
      connection,
      creatingAgent,
      startingAgentId,
      canCreateAgent,
      creation,
      navOpen,
      openAgent?.agentId,
      agentFilterId,
      conversationAgents,
    ],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "n" ||
        !connection
      )
        return;
      if (event.shiftKey && !canCreateAgent) return;
      event.preventDefault();
      openCreation(event.shiftKey ? "agent" : "session");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [connection, canCreateAgent, openCreation]);

  const failedStart = startMutation.isError ? startMutation.variables : null;
  const startFailureNotice =
    failedStart && creation !== "session" ? (
      <Alert
        className={
          openConversation || websites.selected
            ? "inbox-error m-2"
            : "inbox-empty m-auto max-w-[28rem]"
        }
        tone="error"
        title="Couldn't start the conversation."
        action={
          <Button
            variant="outline"
            onClick={() => void startConversation(failedStart.agentId)}
          >
            Retry
          </Button>
        }
      />
    ) : null;

  return (
    <main
      className="inbox-app grove-shell relative flex h-dvh min-h-0 bg-base-200 font-sans text-base-content"
      data-inbox-app
      data-conversation={!!openConversation || websites.selected !== undefined}
    >
      {connection ? (
        <>
          <CreateAgentDialog
            open={creation === "agent"}
            pending={creatingAgent}
            error={agentCreationError}
            canChooseComputer={connection.capabilities.has(computerList)}
            create={createAgent}
            onClose={() => {
              setCreation(null);
            }}
            returnFocus={dialogReturnFocus}
          />
          {creation === "session" ? (
            <CreateSessionDialog
              open
              agents={canWriteAgent ? conversationAgents : []}
              defaultAgentId={startAgent?.agentId ?? null}
              start={startConversation}
              pending={startingAgentId !== null}
              onClose={() => {
                setCreation(null);
              }}
              onNewAgent={
                canCreateAgent
                  ? () => {
                      setCreation("agent");
                    }
                  : undefined
              }
              returnFocus={dialogReturnFocus}
            />
          ) : null}
        </>
      ) : null}
      <NavigationRails
        open={navOpen}
        onOpenChange={setNavOpen}
        returnFocus={navigationReturnFocus}
      >
        <AgentRail
          open={agentRailOpen}
          agents={agents}
          agentFilterId={agentFilterId}
          websitesSelected={websitesOnly}
          websitesVisible={websites.canRead}
          canCreate={connection !== null && canCreateAgent}
          createOpen={creation === "agent"}
          onAll={() => {
            setAgentFilterId(null);
            setWebsitesOnly(false);
          }}
          onWebsites={() => {
            setAgentFilterId(null);
            setWebsitesOnly(true);
          }}
          onAgent={(agentId) => {
            setWebsitesOnly(false);
            openLatest(agentId);
          }}
          onCreate={() => {
            openCreation("agent");
          }}
        />
        <aside
          id="grove-list-rail"
          className={`inbox-sidebar group relative min-h-0 min-w-0 flex-1 flex-col border-r border-base-300 min-[900px]:w-[var(--grove-list-width)] min-[900px]:flex-none ${listRailOpen ? "flex" : "flex min-[900px]:hidden"}`}
          style={listWidthStyle}
          aria-label="Conversations"
        >
          {desktop ? (
            <ResizeHandle
              aria-label="Conversation list width"
              aria-controls="grove-list-rail"
              className="absolute right-0 top-1/2 z-10 translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
              orientation="vertical"
              variant="notch"
              value={listWidth}
              min={listWidthBounds.min}
              max={listWidthBounds.max}
              onValueChange={(width) => {
                setListWidth(() => width);
              }}
              onDoubleClick={() => {
                setListWidth(() => listWidthBounds.initial);
              }}
              {...listResize}
            />
          ) : null}
          <header className="inbox-header flex h-10 flex-none items-center gap-1 border-b border-base-300 pl-3 pr-1">
            <DataListHeading className="min-w-0 flex-1 truncate">
              {websitesOnly && websites.canRead
                ? "Websites"
                : facetAgent
                  ? agentLabel(facetAgent)
                  : "All Agents"}
            </DataListHeading>
            {connection && (canStart || canCreateAgent) ? (
              <IconButton
                aria-label="New conversation"
                aria-haspopup="dialog"
                icon={<SquarePen />}
                iconSize="sm"
                size="sm"
                onClick={() => {
                  openCreation("session");
                }}
              />
            ) : null}
          </header>
          {agentNotice ? (
            <Alert
              tone="info"
              title={agentNotice}
              action={
                <Button
                  variant="ghost"
                  onClick={() => {
                    void connection?.ui
                      .requestAppPermissions({ agents: conversationAccess })
                      .catch((cause: unknown) => {
                        console.error(
                          "Chat inbox or permission request failed",
                          cause,
                        );
                      });
                  }}
                >
                  Allow conversation access
                </Button>
              }
            />
          ) : null}
          {connection && agents.length > 0 && !canStart && !canCreateAgent ? (
            <section
              className="inbox-create inbox-access flex flex-col items-start gap-3 border-b border-base-300 py-2"
              aria-labelledby="inbox-agent-access-title"
            >
              <CardTitle
                level={2}
                id="inbox-agent-access-title"
                className="inbox-access-title m-0"
              >
                Let Grove manage your Agents
              </CardTitle>
              <p>
                Grove creates Agents and carries their conversations. Your Team
                decides what it may do.
              </p>
              <Button size="sm" onClick={requestAgentAccess}>
                Allow Agent access
              </Button>
            </section>
          ) : null}
          {deleteMutation.error ? (
            <Alert tone="error" title={deleteMutation.error.message} />
          ) : null}
          {error ? (
            <Alert
              className="inbox-error"
              tone="error"
              title={error}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void directory.refetch();
                  }}
                >
                  Try again
                </Button>
              }
            />
          ) : null}
          {inboxFailed ? (
            <Alert
              className="inbox-error"
              tone="error"
              title="Conversations are unavailable."
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    inbox.refresh();
                  }}
                >
                  Retry conversations
                </Button>
              }
            />
          ) : null}
          <ScrollArea
            key={agentFilterId}
            ref={listViewport}
            className="inbox-surface min-h-0 flex-1"
            aria-label="Conversations"
          >
            {!connection ? (
              <p className="inbox-empty m-0 px-2 py-3 text-sm text-(--stipe-fg-muted)">
                Connect to the host to browse Agents.
              </p>
            ) : directoryLoading ? (
              <p
                className="inbox-empty m-0 px-2 py-3 text-sm text-(--stipe-fg-muted)"
                role="status"
              >
                Loading Agents…
              </p>
            ) : (
              <InboxList
                viewport={listViewport}
                view={view}
                agents={agentById}
                loading={loadingSessions || websites.loading}
                failed={!!error || inboxFailed || websites.failed}
                pendingSelection={pendingSelection}
                selectedAgentId={selectedAgentId}
                selectedSessionId={selectedSessionId}
                onSelect={openListRow}
                onDelete={
                  canWriteAgent
                    ? (agentId, sessionId) => {
                        deleteMutation.mutate({ agentId, sessionId });
                      }
                    : undefined
                }
                deleting={
                  deleteMutation.isPending ? deleteMutation.variables : null
                }
                websites={websites.rows.filter(
                  (row) =>
                    agentFilterId === null || row.agentId === agentFilterId,
                )}
                selectedWebsite={websites.selected}
                onSelectWebsite={(row) => {
                  conversationOpener?.clear();
                  setNavOpen(false);
                  websites.select(row);
                }}
              />
            )}
          </ScrollArea>
        </aside>
      </NavigationRails>
      <section
        className="inbox-conversation-shell flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label="Conversation"
      >
        <header className="grove-head flex h-10 flex-none items-center gap-2 border-b border-base-300 px-2 text-xs">
          {websites.selected ? (
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 flex-1 items-center gap-1.5"
            >
              <Sigil name="connected" size={14} />
              <DataListHeading className="min-w-0 truncate">
                {websites.selected.siteLabel}
              </DataListHeading>
              <ChevronRight aria-hidden="true" size={12} />
              <span className="min-w-0 truncate">
                {websites.selected.conversation.label || "Website visitor"}
              </span>
            </nav>
          ) : openAgent ? (
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 flex-1 items-center gap-1.5"
            >
              <DataListHeading className="flex-none">
                {agentLabel(openAgent)}
              </DataListHeading>
              {canRenameAgent ? (
                <RenameAgentControl
                  // Remount on agent switch: a stale draft must never leak
                  // between two Agents' open/edit state.
                  key={openAgent.agentId}
                  agentId={openAgent.agentId}
                  name={openAgent.name}
                  rename={renameAgent}
                />
              ) : null}
              {toolPolicy.canRead ? (
                <AllowAppToolsControl
                  status={toolPolicy.status.data}
                  approving={toolPolicy.approve.isPending}
                  onApprove={approveAgentTools}
                />
              ) : null}
              <ChevronRight
                aria-hidden="true"
                className="flex-none text-(--stipe-fg-muted)"
                size={12}
              />
              <span className="min-w-0 truncate text-(--stipe-fg-muted)">
                {openTitle}
              </span>
            </nav>
          ) : null}
        </header>
        <TeamNotices app={connection} />
        {conversationError ? (
          <Alert
            className="inbox-error m-2"
            tone="error"
            title={conversationError}
          />
        ) : null}
        {openConversation || websites.selected ? startFailureNotice : null}
        {websites.selected ? (
          <WebsiteConversation inbox={websites} />
        ) : openConversation ? (
          <Conversation
            open={openConversation}
            connection={connection}
            commands={groveRuntime}
            renderConversation={services.renderConversation}
            composeDraft={composeDraft}
            onPrefilled={() => {
              setComposeDraft(null);
            }}
            onForked={onForked}
            onOpen={openBeside}
          />
        ) : !connection || directoryLoading ? null : agents.length === 0 &&
          !error ? (
          <EmptyState
            className="inbox-empty m-auto max-w-[28rem]"
            variant="speech"
            thinking={creatingAgent}
            renderVisual={({ speaking, thinking }) => (
              <ShiitakeAvatar
                className="h-full w-full"
                state={{
                  activity: thinking
                    ? "thinking"
                    : speaking
                      ? "speaking"
                      : "idle",
                  expression: "normal",
                }}
              />
            )}
            title={canCreateAgent ? "No one's here yet." : "Welcome to Grove"}
            description={
              canCreateAgent
                ? "Agents chat, write and make little games with you. Name someone?"
                : "Let Grove find your Agents, create new ones, and open conversations. Your Team controls this access."
            }
            actions={
              canCreateAgent ? (
                <Button
                  onClick={() => {
                    openCreation("agent");
                  }}
                >
                  Name your first Agent
                </Button>
              ) : (
                <Button onClick={requestAgentAccess}>Allow Agent access</Button>
              )
            }
          />
        ) : (
          (startFailureNotice ?? (
            <EmptyState
              className="inbox-empty m-auto max-w-[28rem]"
              variant="panel"
              title={
                listed > 0
                  ? "Pick up a conversation"
                  : startAgent
                    ? `Say hello to ${agentLabel(startAgent)}`
                    : "No conversations yet"
              }
              description={
                listed > 0
                  ? "Choose one from the list, or ask for something new. A tiny game is a good start."
                  : "Ask for anything. Try: “Make me a tiny game where a mushroom catches raindrops.”"
              }
              actions={
                canStart ? (
                  <Button
                    variant="outline"
                    loading={startingAgentId === startAgent.agentId}
                    disabled={startingAgentId !== null}
                    onClick={() => void startConversation(startAgent.agentId)}
                  >
                    {listed > 0
                      ? `Ask ${agentLabel(startAgent)} something`
                      : "Start a conversation"}
                  </Button>
                ) : undefined
              }
            />
          ))
        )}
      </section>
      {besideConversation === null ? null : (
        <section
          className="inbox-conversation-shell flex min-h-0 min-w-0 flex-1 flex-col border-l border-base-300"
          aria-label="Beside conversation"
          data-inbox-beside
        >
          <header className="grove-head flex h-10 flex-none items-center gap-2 border-b border-base-300 px-2 text-xs">
            <DataListHeading className="min-w-0 flex-1 truncate">
              {besideAgent === undefined
                ? besideConversation.agentId
                : agentLabel(besideAgent)}
            </DataListHeading>
            <IconButton
              aria-label="Close beside conversation"
              icon={<X />}
              iconSize="sm"
              size="sm"
              onClick={() => {
                besideOpener?.clear();
              }}
            />
          </header>
          <Conversation
            open={besideConversation}
            connection={connection}
            commands={besideRuntime}
            renderConversation={services.renderConversation}
            composeDraft={null}
            onPrefilled={() => undefined}
            onForked={(sessionId) => {
              besideOpener?.select(
                besideConversation.agentId,
                sessionId,
                false,
                false,
              );
            }}
            onOpen={openBeside}
            label="Beside conversation"
          />
        </section>
      )}
    </main>
  );
}
