import { useAppHeaderRef } from "@fungi.computer/caps/components/app-header";
import { failureMessage } from "@fungi.computer/agar/errors";
import { AppError } from "@fungi.computer/agar";
import type { MemberInboxSession } from "@fungi.computer/agar/inbox";
import { Alert } from "@fungi.computer/caps/components/alert";
import { CardTitle } from "@fungi.computer/caps/components/card";
import { AgentRail, connectModelFirst } from "./agent-rail.js";
import { TeamNotices } from "./team-notices.js";
import { NavigationRails, useNavigationDesktop } from "./navigation-rails.js";
import { CreateAgentDialog } from "./create-agent-dialog.js";
import { CreateSessionDialog } from "./create-session-dialog.js";
import { RouterProvider } from "@tanstack/react-router";
import {
  createInboxRouter,
  InboxRouteContent,
  shownSelection,
  useInboxNavigation,
  type InboxRouter,
} from "./navigation.js";
import {
  agentLabel,
  buildInboxView,
  listedInboxRows,
  type InboxOpenSessionState,
} from "./inbox-model.js";
import {
  agentManage,
  agentAvatar,
  agentList,
  agentRename,
  agentSessionWrite,
  agentStop,
  openAppAgent,
  type AppAgent,
  type AppAgentCreateInput,
} from "@fungi.computer/agar/agents";
import { RenameAgentControl } from "./rename-agent-control.js";
import { AllowAppToolsControl } from "./allow-app-tools-control.js";
import {
  AgentExtensionsControl,
  type ExtensionChange,
} from "./agent-extensions-control.js";
import type {
  AgentAccessOperation,
  AppRoot,
  SetupState,
  AppStatusItem,
} from "@fungi.computer/agar";
import { useGroveCommands } from "./grove-commands.js";
import { stopAgentTree } from "./stop-all.js";
import { readAgentModels } from "./agent-models.js";
import type { AgentModelList } from "@fungi.computer/shiitake/model-list";
import { createWhistle } from "@fungi.computer/whistle";
import type { RowV1 } from "@fungi.computer/gills";
import { defineIdFamily } from "@fungi.computer/cairn/id";
import { correlationKey } from "@fungi.computer/cairn";
import {
  ShiitakeAvatar,
  type AgentHeadActivity,
} from "@fungi.computer/parakeet";
import {
  sessionModelCommandDefinitions,
  sessionCommandDefinitions,
  sessionQueryOptions,
  sessionViewState,
  type ParakeetCommandRuntime,
} from "@fungi.computer/parakeet/headless";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useAppContext, useWindowStatus } from "@fungi.computer/agar/react";
import { queryKeys } from "@fungi.computer/agar/query";
import { appStorage } from "@fungi.computer/agar/storage";
import { firstSessionRequestId } from "./first-session.js";
import {
  useInboxData,
  useAgentInstructions,
  useAgentExtensions,
  useAgentToolPolicy,
} from "./queries.js";
import {
  AgentInstructionsControl,
  type InstructionsSave,
} from "./agent-instructions-control.js";
import { AgentAvatarControl } from "./agent-avatar-control.js";
import type { Avatar } from "@fungi.computer/sprite/avatar";
import { createShiitakeClient } from "@fungi.computer/shiitake/client";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@fungi.computer/caps/components/button";
import { ResizeHandle } from "@fungi.computer/caps/components/resize-handle";
import { usePointerDrag } from "@fungi.computer/maosaico";
import {
  clampListWidth,
  listWidthBounds,
  chooseAgent,
  useGroveLayout,
} from "./grove-layout.js";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { PanelLeftOpen, SquarePen } from "lucide-react";
import { ScrollArea } from "@fungi.computer/caps/components/scroll-area";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import { HeadLoading } from "./head-loading.js";
import { ModelSetup } from "./model-setup.js";
import { InboxList } from "./inbox-list.js";
import { useAwaitingApprovalSessions } from "./approval-owners.js";
import { showConversationToast } from "./conversation-toast.js";
import { useWebsiteInbox } from "./website-inbox.js";
import {
  createConversationView,
  initialViewState,
  openingTarget,
  shownConversation,
  type ConversationViewSnapshot,
} from "@fungi.computer/parakeet/conversation-view";
import {
  createConversationOpeningOwner,
  eventSourceFor,
  type InboxClient,
  type OpenConversation,
} from "@fungi.computer/parakeet/conversation-opening";

const WebsiteConversation = lazy(async () => {
  const module = await import("./website-conversation.js");
  return { default: module.WebsiteConversation };
});

const ParakeetConversation = lazy(async () => {
  const module = await import("./parakeet-conversation.js");
  return { default: module.ParakeetConversation };
});

export type InboxServices = Readonly<{
  openAgent: typeof openAppAgent;
  createClient: (
    options: Parameters<typeof createShiitakeClient>[0],
  ) => InboxClient;
  /** Open a conversation with the first Agent when there is nothing to pick up. */
  autoOpen?: boolean;
  renderConversation?: (
    open: OpenConversation,
    composeDraft: Readonly<{
      requestId: string;
      text: string;
    }> | null,
    onOpen: (target: NonNullable<RowV1["open"]>) => void,
  ) => React.ReactNode;
}>;

export const defaultServices: InboxServices = {
  openAgent: openAppAgent,
  createClient: createShiitakeClient,
  autoOpen: true,
};

/** Grove asks its host for these; the host bounds and grants them. */
/** The Agent operations Grove asks for so it can list Agents and chat with them. */
export const groveAgentAccess: readonly AgentAccessOperation[] = [
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

export const sessionCreateRequests = defineIdFamily({
  family: "grove-session-create-request",
  version: 1,
  kinds: { request: { prefix: "request" } },
});

export async function withAgentClient<T>(
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

/** One open Session in Grove's Parakeet runtime; the widget reuses it. */
export function Conversation({
  open,
  renderConversation,
  connection,
  commands,
  composeDraft,
  onPrefilled,
  onForked,
  onOpen,
  models,
  autoFocus,
  empty,
  opening = false,
  label = "Conversation",
  loadingAgent,
  agentName,
}: {
  connection: AppRoot | null;
  /** Whether the host has a model connected, when it says. */
  models?: SetupState | undefined;
  /**
   * Another conversation is opening. This one stays in view with its draft, but
   * cannot be typed into: a message sent now would land in a Session the
   * person is about to leave.
   */
  opening?: boolean | undefined;
  /** Focus the composer on open (the main pane, not a beside conversation). */
  autoFocus?: boolean | undefined;
  /** What an empty conversation shows; absent, Parakeet's quiet prompt. */
  empty?: React.ReactNode;
  commands: ParakeetCommandRuntime;
  open: OpenConversation;
  renderConversation?: InboxServices["renderConversation"];
  composeDraft: Readonly<{
    requestId: string;
    text: string;
  }> | null;
  onPrefilled: () => void;
  onForked: (sessionId: string) => void;
  onOpen: (target: NonNullable<RowV1["open"]>) => void;
  label?: string;
  /** The Agent whose head the loading state draws, when the host knows it; absent, the mascot. */
  loadingAgent?: AppAgent | undefined;
  /** The Agent's live name, shown in the composer as "Message <name>…". */
  agentName?: string | undefined;
}): React.JSX.Element {
  const session = open.session;
  const pane = useRef<HTMLElement>(null);
  useEffect(() => {
    pane.current?.toggleAttribute("inert", opening);
  }, [opening]);
  const [modelCatalog, setModelCatalog] = useState<
    | { kind: "loading" }
    | { kind: "unavailable" }
    | { kind: "ready"; models: AgentModelList }
  >({ kind: "loading" });
  useEffect(() => {
    if (!connection || renderConversation) return;
    const controller = new AbortController();
    setModelCatalog({ kind: "loading" });
    void readAgentModels(
      connection.capabilities,
      open.agentId,
      controller.signal,
    ).then(
      (models) => {
        if (!controller.signal.aborted)
          setModelCatalog({ kind: "ready", models });
      },
      () => {
        if (!controller.signal.aborted)
          setModelCatalog({ kind: "unavailable" });
      },
    );
    return () => {
      controller.abort();
    };
  }, [connection, open.agentId, renderConversation]);
  useEffect(() => {
    // One source owns the Session namespace. The model key, Settings and
    // /model all invoke the same command and Shiitake preference owner.
    const lease = commands.contribute({
      sourceId: "grove-session",
      namespace: "session",
      commands: [
        ...sessionCommandDefinitions(session, {
          sourceId: "grove-session",
          namespace: "session",
          sessionResumeAvailable: false,
          forkAvailable: true,
          onForked,
        }),
        ...(renderConversation
          ? []
          : sessionModelCommandDefinitions(session, {
              sourceId: "grove-session",
              namespace: "session",
              models: modelCatalog.kind === "ready" ? modelCatalog.models : [],
              refreshModels: (signal) => {
                if (!connection)
                  return Promise.reject(
                    new Error("Agent connection is unavailable"),
                  );
                return readAgentModels(
                  connection.capabilities,
                  open.agentId,
                  signal,
                );
              },
              availability: () =>
                modelCatalog.kind === "ready" && modelCatalog.models.length > 0
                  ? { status: "available" }
                  : {
                      status: "unavailable",
                      reason:
                        modelCatalog.kind === "loading"
                          ? "Loading this Agent's models"
                          : modelCatalog.kind === "ready"
                            ? "This Agent has no available models"
                            : "This Agent's model catalog is unavailable",
                    },
            })),
      ],
    });
    return () => {
      lease.dispose();
    };
  }, [
    commands,
    session,
    onForked,
    renderConversation,
    modelCatalog,
    connection,
    open.agentId,
  ]);
  return (
    <section
      ref={pane}
      className="inbox-conversation min-h-0 min-w-0 flex-1"
      data-inbox-conversation
      aria-busy={opening}
      aria-label={label}
    >
      {renderConversation ? (
        renderConversation(open, composeDraft, onOpen)
      ) : (
        <Suspense
          fallback={
            <HeadLoading agent={loadingAgent} message="Opening conversation…" />
          }
        >
          <ParakeetConversation
            session={session}
            draftIdentity={{ agentId: open.agentId, sessionId: open.sessionId }}
            connection={connection}
            commands={commands}
            prefill={composeDraft}
            onPrefilled={onPrefilled}
            onOpen={onOpen}
            models={models}
            autoFocus={autoFocus}
            empty={empty}
            agentName={agentName}
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

const emptyViewSnapshot: ConversationViewSnapshot = {
  state: initialViewState,
  error: null,
};
const subscribeNothing = (): (() => void) => () => undefined;

export function InboxApp(props: InboxProps): React.JSX.Element {
  useAppContext(props.connection);
  return (
    <RoutedInbox
      key={JSON.stringify(queryKeys.of(props.connection))}
      {...props}
    />
  );
}

/** What a host's refusal to change an Agent's extensions means, in plain words. */
function extensionRefusal(
  kind: "attach" | "detach",
  label: string,
  error: "not_found" | "not_granted" | "not_extension",
): string {
  const action = `Couldn't ${kind} ${label}`;
  if (error === "not_extension")
    return `${action}: it isn't an enabled App that adds to an Agent anymore.`;
  if (error === "not_granted")
    return `${action}: only the owner can change an Agent's extensions.`;
  return `${action}: this Agent no longer exists.`;
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
  const headerRef = useAppHeaderRef();
  const queryClient = useQueryClient();
  const websites = useWebsiteInbox(connection, services);
  // One owner decides which conversation is in view and opens it; Grove
  // dispatches intents and reads its snapshot (Parakeet's conversation-view).
  const conversationView = useMemo(
    () =>
      connection === null
        ? null
        : createConversationView({
            connection,
            queryClient,
            services,
            navigate: (target) =>
              target === null
                ? router.navigate({ to: "/", search: true, replace: true })
                : navigateSession(target.agentId, target.sessionId),
            shownRoute: () => shownSelection(router),
          }),
    [connection, navigateSession, queryClient, router, services],
  );
  const viewSnapshot = useSyncExternalStore(
    conversationView?.subscribe ?? subscribeNothing,
    conversationView?.snapshot ?? (() => emptyViewSnapshot),
  );
  const {
    directory,
    inbox,
    computerChoices,
    createAgent: createAgentMutation,
    renameAgent: renameAgentMutation,
    setAgentAvatar: setAgentAvatarMutation,
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
    onError: (cause) => {
      if (!connection) return;
      showConversationToast(connection.ui, {
        variant: "error",
        message: failureMessage("The conversation could not be deleted", cause),
      });
    },
    onSuccess: (_deleted, target) => {
      if (
        selection?.agentId === target.agentId &&
        selection.sessionId === target.sessionId
      ) {
        conversationView?.leave(true);
      }
      inbox.refresh();
    },
  });
  const startingAgentId = startMutation.isPending
    ? startMutation.variables.agentId
    : null;
  const pendingSelection = openingTarget(viewSnapshot.state);
  // While another conversation opens, the one being left stays the open one
  // for the list and header; the pane itself waits for the new one.
  const openConversation = shownConversation(viewSnapshot.state);
  const [websitesOnly, setWebsitesOnly] = useState(false);
  const selectedAgentId = openConversation?.agentId ?? null;
  const selectedSessionId = openConversation?.sessionId ?? null;
  const [creation, setCreation] = useState<"agent" | "session" | null>(null);
  const dialogReturnFocus = useRef<HTMLElement | null>(null);
  const memberStorage = useMemo(
    () =>
      connection?.capabilities.has(appStorage)
        ? connection.capabilities.require(appStorage)
        : undefined,
    [connection],
  );
  const [layout, setLayout, layoutReady] = useGroveLayout(memberStorage);
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
  const appRoot = useRef<HTMLElement | null>(null);
  const measuredDesktop = useNavigationDesktop(appRoot);
  const desktop = measuredDesktop ?? true;
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
  const appContext = useAppContext(connection);
  const openRequest = appContext?.openRequest ?? null;
  const modelsMissing = appContext?.setup?.models === "missing";
  const handledOpenRequestId = useRef<string | null>(null);
  // The route as the router last published it, for a new view to rejoin.
  const routeRef = useRef<{ agentId: string; sessionId: string } | null>(null);
  useEffect(() => {
    if (conversationView === null) return;
    conversationView.observeRoute(routeRef.current);
    return () => {
      sessionCreateIntent.current = null;
      conversationView.close();
    };
  }, [conversationView]);

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
      besideOpener?.select(agentId, sessionId);
    },
    [besideOpener],
  );

  // A row, a host request or a started conversation is a choice: it opens at
  // once and the route follows it (see conversation-view.ts for the rules).
  const selectSession = useCallback(
    (agentId: string, sessionId: string, fromOpenRequest = false): void => {
      if (conversationView === null) return;
      if (startMutation.isError) startMutation.reset();
      websites.clear();
      setWebsitesOnly(false);
      conversationView.select(
        { agentId, sessionId },
        fromOpenRequest ? "host" : "person",
      );
    },
    [
      conversationView,
      websites.clear,
      startMutation.isError,
      startMutation.reset,
    ],
  );

  const routeAgentId = selection?.agentId;
  const routeSessionId = selection?.sessionId;
  routeRef.current =
    routeAgentId !== undefined && routeSessionId !== undefined
      ? { agentId: routeAgentId, sessionId: routeSessionId }
      : null;
  useEffect(() => {
    conversationView?.observeRoute(routeRef.current);
  }, [conversationView, routeAgentId, routeSessionId]);

  const onForked = useCallback(
    (sessionId: string): void => {
      if (!openConversation) return;
      selectSession(openConversation.agentId, sessionId);
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

  const conversationShown =
    !!openConversation || websites.selected !== undefined;
  const startConversation = useCallback(
    async (agentId: string, cause: "person" | "auto" = "person") => {
      if (!connection || !conversationView || startingAgentId !== null)
        return "Conversation creation is unavailable.";
      // Grove's own first conversation never competes with a person's choice.
      const request = conversationView.create(cause);
      if (!request.accepted || request.ticket === null) return undefined;
      setConversationError(null);
      try {
        // Grove's own first conversation shares one request with the chat
        // widget, so the two frames never make two Sessions.
        const intent =
          sessionCreateIntent.current?.agentId === agentId
            ? sessionCreateIntent.current
            : {
                agentId,
                requestId:
                  cause === "auto" && memberStorage !== undefined
                    ? await firstSessionRequestId(memberStorage, () =>
                        sessionCreateRequests.request.generate(),
                      )
                    : sessionCreateRequests.request.generate(),
              };
        sessionCreateIntent.current = intent;
        const sessionId = await startMutation.mutateAsync(intent);
        // The loaded member inbox owns the new row and resumes its feed.
        // A Session another choice has since superseded is simply not shown.
        const placed = conversationView.created(request.ticket, {
          agentId,
          sessionId,
        });
        if (placed.accepted) {
          if (startMutation.isError) startMutation.reset();
          websites.clear();
          setWebsitesOnly(false);
        }
        // Session creation can beat this App's visibility feed delta. Reload
        // the owner snapshot without delaying the new conversation opening.
        inbox.refresh();
        setCreation(null);
        setNavOpen(false);
        if (sessionCreateIntent.current === intent)
          sessionCreateIntent.current = null;
        return undefined;
      } catch (cause: unknown) {
        conversationView.createFailed(request.ticket);
        console.error("Grove conversation creation failed", cause);
        // With a conversation open the failure is a toast; the empty state
        // keeps its Retry card.
        if (conversationShown)
          showConversationToast(connection.ui, {
            variant: "error",
            message: failureMessage(
              "The conversation could not be started",
              cause,
            ),
          });
        return cause instanceof Error
          ? cause.message
          : "Couldn't start the conversation.";
      }
    },
    [
      connection,
      conversationShown,
      conversationView,
      memberStorage,
      startingAgentId,
      startMutation.isError,
      startMutation.mutateAsync,
      startMutation.reset,
      websites.clear,
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
      setDraft: (text) => {
        if (
          pendingSelection !== null ||
          !openConversation ||
          !connection?.capabilities.has(agentSessionWrite) ||
          !agents.some(
            (agent) =>
              agent.agentId === openConversation.agentId &&
              agent.sessionOperations.includes("agent.send"),
          )
        )
          return false;
        setComposeDraft({ requestId: correlationKey(), text });
        return true;
      },
      newConversation: () => {
        if (openConversation) void startConversation(openConversation.agentId);
      },
      stopAll:
        openConversation && connection?.capabilities.has(agentStop)
          ? () => {
              void stopAgentTree(connection, openConversation.agentId);
            }
          : undefined,
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
  const agentActivity = useMemo(() => {
    const activity = new Map<string, AgentHeadActivity>();
    for (const row of sessions) {
      if (!("state" in row)) continue;
      if (row.state === "needs_you") activity.set(row.agentId, "speaking");
      else if (row.state === "running" && !activity.has(row.agentId))
        activity.set(row.agentId, "thinking");
    }
    return activity;
  }, [sessions]);
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
  const awaitingApproval = useAwaitingApprovalSessions(
    connection?.capabilities,
  );
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
  const openNavigationSheet = () => {
    navigationReturnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setNavOpen(true);
  };
  const listed = listedInboxRows(view).length;
  // Phones keep the list in a sheet, so only the desktop pane is ever "visible".
  const listVisible = desktop && listRailOpen;
  const emptyModelSetup =
    desktop &&
    modelsMissing &&
    listed === 0 &&
    view.unavailable.length === 0 &&
    websites.rows.length === 0 &&
    !openConversation &&
    !websites.selected &&
    !directoryLoading &&
    !loadingSessions &&
    !websites.loading &&
    !inboxFailed &&
    !error &&
    !websites.failed;
  const navigationStatus: readonly AppStatusItem[] = desktop
    ? [
        {
          kind: "button",
          id: "agents",
          text: "Agents",
          expanded: agentRailOpen,
          title: agentRailOpen ? "Hide Agents" : "Show Agents",
        },
        ...(emptyModelSetup
          ? []
          : [
              {
                kind: "button" as const,
                id: "conversations",
                text: "Conversations",
                expanded: listRailOpen,
                title: listRailOpen
                  ? "Hide conversations"
                  : "Show conversations",
              },
            ]),
      ]
    : [
        {
          kind: "button",
          id: "agents",
          text: "Agents and conversations",
          opens: "dialog",
          expanded: navOpen,
        },
      ];
  useWindowStatus(
    connection,
    [
      ...navigationStatus,
      ...(besideConversation === null
        ? []
        : [
            {
              kind: "button" as const,
              id: "close-beside",
              text: "Close beside",
              title: "Close beside conversation",
            },
          ]),
    ],
    (action) => {
      if (creation !== null) return false;
      if (action.itemId === "close-beside" && besideConversation !== null) {
        besideOpener?.clear();
      } else if (desktop && action.itemId === "agents") {
        setAgentRailOpen((open) => !open);
      } else if (desktop && action.itemId === "conversations") {
        setListRailOpen((open) => !open);
      } else if (!desktop && action.itemId === "agents") {
        if (navOpen) setNavOpen(false);
        else openNavigationSheet();
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
  const facetAgent =
    agentFilterId === null ? undefined : agentById.get(agentFilterId);
  // After a reload the window reopens on the Agent last selected, or the only
  // Agent; later selections are remembered. A route that names an Agent wins.
  const agentRestored = useRef(false);
  const savedAgentId = layout.agentId;
  useEffect(() => {
    if (!layoutReady || directory.data === undefined) return;
    if (!agentRestored.current) {
      agentRestored.current = true;
      if (agentFilterId !== null || selection !== undefined) return;
      const target =
        directory.data.find((agent) => agent.agentId === savedAgentId) ??
        (directory.data.length === 1 ? directory.data[0] : undefined);
      if (target) setAgentFilterId(target.agentId);
      return;
    }
    if ((agentFilterId ?? undefined) !== savedAgentId)
      setLayout((current) => chooseAgent(current, agentFilterId));
  }, [
    layoutReady,
    directory.data,
    agentFilterId,
    selection,
    savedAgentId,
    setAgentFilterId,
    setLayout,
  ]);
  const canRenameAgent = connection?.capabilities.has(agentRename) ?? false;
  // The starter Agent is named by the host; the person renames it from here.
  const soleAgent = agents.length === 1 ? agents[0] : undefined;
  const renameTarget = facetAgent ?? soleAgent;
  // The open rename form takes the header row; the other keys wait.
  const [renaming, setRenaming] = useState(false);
  const headerTitle = (
    <CardTitle level={2} className="m-0 min-w-0 flex-1 truncate text-sm">
      {websitesOnly && websites.canRead
        ? "Websites"
        : facetAgent
          ? agentLabel(facetAgent)
          : "All agents"}
    </CardTitle>
  );
  const canSetAgentAvatar = connection?.capabilities.has(agentAvatar) ?? false;
  const toolPolicy = useAgentToolPolicy(
    connection,
    facetAgent?.agentId ?? null,
  );
  const instructions = useAgentInstructions(
    connection,
    facetAgent?.agentId ?? null,
  );
  const extensions = useAgentExtensions(
    connection,
    facetAgent?.agentId ?? null,
  );
  const saveInstructions = useCallback(
    async (
      agentId: string,
      edit: { expectedContent: string | null; content: string },
    ): Promise<InstructionsSave> => {
      try {
        await instructions.save.mutateAsync({ agentId, ...edit });
        return "saved";
      } catch (cause) {
        // The dialog stays open on the draft and says what happened.
        if (cause instanceof AppError && cause.code === "CONFLICT")
          return "conflict";
        if (cause instanceof AppError && cause.code === "FILE_TOO_LARGE")
          return "too_large";
        return { failed: cause };
      }
    },
    [instructions.save.mutateAsync],
  );
  const reloadInstructions = useCallback(async () => {
    const latest = await instructions.read.refetch({ throwOnError: true });
    if (latest.data === undefined) throw new Error("No instructions file");
    return latest.data;
  }, [instructions.read.refetch]);
  const changeExtension = useCallback(
    async (change: ExtensionChange) => {
      if (!facetAgent) return;
      const known = [
        ...(extensions.read.data?.attached ?? []),
        ...(extensions.read.data?.available ?? []),
      ].find((item) => item.installationId === change.installationId);
      const label = known?.name ?? "that App";
      const say = (message: string) => {
        void connection?.ui
          .showToast({ message, tone: "error" })
          .catch((cause: unknown) => {
            console.error("Extensions toast failed", cause);
          });
      };
      try {
        const result = await extensions.change.mutateAsync({
          agentId: facetAgent.agentId,
          ...change,
        });
        if ("error" in result)
          say(extensionRefusal(change.kind, label, result.error));
      } catch (cause) {
        console.error("Agent extension change failed", cause);
        // The host refused this App for this Agent; the network is fine.
        say(
          cause instanceof AppError && cause.code === "CAPABILITY_DENIED"
            ? `Couldn't ${change.kind} ${label}: this App isn't allowed to change this Agent's extensions.`
            : `Couldn't ${change.kind} ${label}. Check your connection and try again.`,
        );
      }
    },
    [
      connection,
      facetAgent,
      extensions.read.data,
      extensions.change.mutateAsync,
    ],
  );
  const notifyInstructions = useCallback(
    (message: string, tone: "error" | "warning") => {
      void connection?.ui
        .showToast({ message, tone })
        .catch((cause: unknown) => {
          console.error("Instructions toast failed", cause);
        });
    },
    [connection],
  );

  // With an Agent present and nothing to pick up, open a conversation with it: the
  // composer is the first thing on screen, and Grove open → type → Enter sends.
  // The Websites view lists no Agent rows, but choosing it is not "nothing to
  // pick up": it must not start a conversation and leave the view.
  // Opening a creation dialog is the person's own choice: it ends the
  // automatic start for good, so nothing starts behind it or after it closes.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (creation !== null) autoStarted.current = true;
    if (
      services.autoOpen !== true ||
      autoStarted.current ||
      !connection ||
      websitesOnly ||
      openConversation ||
      openRequest !== null ||
      directoryLoading ||
      loadingSessions ||
      inboxFailed ||
      error ||
      modelsMissing ||
      listed > 0 ||
      startAgent === undefined ||
      !canWriteAgent ||
      startingAgentId !== null
    )
      return;
    autoStarted.current = true;
    void startConversation(startAgent.agentId, "auto");
  }, [
    canWriteAgent,
    connection,
    creation,
    directoryLoading,
    error,
    inboxFailed,
    listed,
    loadingSessions,
    modelsMissing,
    openConversation,
    openRequest,
    services.autoOpen,
    startAgent,
    startConversation,
    startingAgentId,
    websitesOnly,
  ]);

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
  const setAgentAvatar = useCallback(
    async (agentId: string, avatar: Avatar): Promise<boolean> => {
      if (!connection) return false;
      try {
        await setAgentAvatarMutation.mutateAsync({ agentId, avatar });
        return true;
      } catch {
        // The dialog stays open on the draft; the next Save retries.
        return false;
      }
    },
    [connection, setAgentAvatarMutation.mutateAsync],
  );
  const approveAgentTools = useCallback(() => {
    const status = toolPolicy.status.data;
    if (!facetAgent || status === undefined || status === null) return;
    toolPolicy.approve.mutate({
      agentId: facetAgent.agentId,
      expectedRevision: status.revision,
    });
  }, [facetAgent, toolPolicy.status.data, toolPolicy.approve]);

  const openCreation = useCallback(
    (kind: "agent" | "session") => {
      if (
        !connection ||
        creatingAgent ||
        startingAgentId !== null ||
        (kind === "agent" && !canCreateAgent)
      )
        return;
      if (kind === "agent" && modelsMissing) {
        void connection.ui
          .showToast({ message: connectModelFirst, tone: "info" })
          .catch((cause: unknown) => {
            console.error("Grove toast failed", cause);
          });
        return;
      }
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
      modelsMissing,
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

  // The Hub offers an owner their starter Agent while it reads the directory,
  // so an owner whose directory still comes back empty was refused it.
  const starterRefused =
    connection !== null &&
    canCreateAgent &&
    !directoryLoading &&
    !modelsMissing &&
    !error &&
    agents.length === 0;
  const starterPending = directory.isFetching;
  useEffect(() => {
    if (starterRefused)
      showConversationToast(connection.ui, {
        variant: "error",
        message: "Your first Agent couldn't be set up.",
      });
  }, [starterRefused, connection]);

  const failedStart = startMutation.isError ? startMutation.variables : null;
  const startFailureNotice =
    failedStart && creation !== "session" && !conversationShown ? (
      <Alert
        className="inbox-empty m-auto max-w-[28rem]"
        tone="error"
        title="Couldn't start the conversation."
        description={startMutation.error?.message}
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
      ref={appRoot}
      className="inbox-app grove-shell @container/grove relative flex h-dvh min-h-0 bg-base-200 font-sans text-base-content"
      data-inbox-app
      data-conversation={!!openConversation || websites.selected !== undefined}
    >
      {connection ? (
        <>
          <CreateAgentDialog
            open={creation === "agent"}
            pending={creatingAgent}
            error={agentCreationError}
            addCredit={
              createAgentMutation.error instanceof AppError &&
              createAgentMutation.error.code === "INSUFFICIENT_CREDIT"
                ? () => connection.ui.openTeamBilling()
                : null
            }
            computers={
              computerChoices.isError
                ? {
                    status: "unavailable",
                    message:
                      "Your Computers could not be loaded. New Computer and No Computer still work.",
                  }
                : computerChoices.isPending
                  ? { status: "loading" }
                  : computerChoices.data === null
                    ? { status: "not-offered" }
                    : { status: "offered", computers: computerChoices.data }
            }
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
      {measuredDesktop === null ? null : (
        <NavigationRails
          desktop={desktop}
          open={navOpen}
          onOpenChange={setNavOpen}
          returnFocus={navigationReturnFocus}
        >
          <AgentRail
            open={agentRailOpen}
            agents={agents}
            agentActivity={agentActivity}
            agentFilterId={agentFilterId}
            websitesSelected={websitesOnly}
            websitesVisible={websites.canRead}
            canCreate={connection !== null && canCreateAgent}
            modelsMissing={modelsMissing}
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
          {emptyModelSetup ? null : (
            <aside
              id="grove-list-rail"
              className={`inbox-sidebar group relative min-h-0 min-w-0 flex-1 flex-col border-r border-base-300 @min-[900px]/grove:w-[var(--grove-list-width)] @min-[900px]/grove:flex-none ${listRailOpen ? "flex" : "flex @min-[900px]/grove:hidden"}`}
              style={listWidthStyle}
              aria-label="Conversations"
            >
              {desktop ? (
                <ResizeHandle
                  aria-label="Conversation list width"
                  aria-controls="grove-list-rail"
                  className="absolute right-0 top-1/2 z-10 translate-x-1/2 -translate-y-1/2"
                  orientation="vertical"
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
              {/* Each per-Agent control remounts for a new Agent; their keys
                  share this parent, so each carries its own prefix. */}
              <header
                className="inbox-header flex h-10 flex-none items-center gap-1 border-b border-base-300 pl-3 pr-1"
                ref={headerRef}
              >
                {facetAgent ? (
                  <AgentAvatarControl
                    key={`avatar:${facetAgent.agentId}`}
                    agentId={facetAgent.agentId}
                    name={agentLabel(facetAgent)}
                    avatar={facetAgent.avatar}
                    {...(canSetAgentAvatar
                      ? { setAvatar: setAgentAvatar }
                      : {})}
                  />
                ) : null}
                {renameTarget && canRenameAgent ? (
                  <RenameAgentControl
                    key={`rename:${renameTarget.agentId}`}
                    agentId={renameTarget.agentId}
                    name={renameTarget.name}
                    rename={renameAgent}
                    title={headerTitle}
                    onEditingChange={setRenaming}
                  />
                ) : (
                  headerTitle
                )}
                {!renaming && facetAgent && instructions.canUse ? (
                  <AgentInstructionsControl
                    key={`instructions:${facetAgent.agentId}`}
                    agentId={facetAgent.agentId}
                    name={facetAgent.name}
                    file={instructions.read.data}
                    loading={instructions.read.isPending}
                    save={saveInstructions}
                    reload={reloadInstructions}
                    notify={notifyInstructions}
                  />
                ) : null}
                {!renaming && facetAgent && extensions.canUse ? (
                  <AgentExtensionsControl
                    key={`extensions:${facetAgent.agentId}`}
                    agentId={facetAgent.agentId}
                    name={facetAgent.name}
                    extensions={extensions.read.data ?? undefined}
                    loading={extensions.read.isPending}
                    change={changeExtension}
                  />
                ) : null}
                {!renaming && connection && (canStart || canCreateAgent) ? (
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
              {facetAgent && toolPolicy.canRead ? (
                <AllowAppToolsControl
                  status={toolPolicy.status.data}
                  approving={toolPolicy.approve.isPending}
                  onApprove={approveAgentTools}
                />
              ) : null}
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
              {connection &&
              agents.length > 0 &&
              !canStart &&
              !canCreateAgent ? (
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
                    Grove creates Agents and carries their conversations. Your
                    Team decides what it may do.
                  </p>
                  <Button size="sm" onClick={requestAgentAccess}>
                    Allow Agent access
                  </Button>
                </section>
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
                  <LoadingState framed={false} message="Loading Agents…" />
                ) : (
                  <InboxList
                    viewport={listViewport}
                    view={view}
                    agents={agentById}
                    loading={loadingSessions || websites.loading}
                    failed={!!error || inboxFailed || websites.failed}
                    showEmptyState={!modelsMissing}
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
                    awaitingApproval={awaitingApproval}
                    onSelectWebsite={(row) => {
                      conversationView?.leave(false);
                      setNavOpen(false);
                      websites.select(row);
                    }}
                  />
                )}
              </ScrollArea>
            </aside>
          )}
          {desktop && !listRailOpen && !emptyModelSetup ? (
            // The hidden list keeps its own way back, so a saved layout can
            // never leave the person with no list and no control for it.
            <div className="flex w-10 flex-none flex-col items-center border-r border-base-300 pt-1">
              <IconButton
                aria-label="Show conversations"
                aria-controls="grove-list-rail"
                aria-expanded={false}
                icon={<PanelLeftOpen />}
                iconSize="sm"
                size="sm"
                onClick={() => {
                  setListRailOpen(() => true);
                }}
              />
            </div>
          ) : null}
        </NavigationRails>
      )}
      <section
        className="inbox-conversation-shell flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label="Conversation"
      >
        <TeamNotices app={connection} />
        {(conversationError ?? viewSnapshot.error) ? (
          <Alert
            className="inbox-error m-2"
            tone="error"
            title={conversationError ?? viewSnapshot.error ?? ""}
          />
        ) : null}
        {websites.selected ? (
          <Suspense fallback={null}>
            <WebsiteConversation inbox={websites} ui={connection?.ui ?? null} />
          </Suspense>
        ) : pendingSelection !== null && openConversation === null ? (
          <LoadingState
            className="m-auto"
            framed={false}
            message="Opening conversation…"
          />
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
            models={appContext?.setup?.models}
            autoFocus={desktop && creation === null}
            opening={pendingSelection !== null}
            agentName={openAgent?.name}
          />
        ) : !connection || directoryLoading ? (
          <LoadingState
            className="m-auto"
            framed={false}
            message={
              connection
                ? canCreateAgent
                  ? "Getting Shiitake ready…"
                  : "Loading Agents…"
                : "Connecting to Oyster…"
            }
          />
        ) : modelsMissing && (agents.length > 0 || canCreateAgent) ? (
          <ModelSetup
            connection={connection}
            navigation={
              desktop
                ? undefined
                : { open: navOpen, onOpen: openNavigationSheet }
            }
          />
        ) : agents.length === 0 && !error ? (
          <EmptyState
            className="inbox-empty m-auto max-w-[28rem]"
            variant="speech"
            thinking={starterPending}
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
            title={
              canCreateAgent ? "Shiitake isn't ready yet" : "Welcome to Grove"
            }
            description={
              canCreateAgent
                ? "Your first Agent couldn't be set up. Try again, or check your Team's credit."
                : "Let Grove find your AI helpers, create new ones, and open conversations. Your Team controls this access."
            }
            actions={
              canCreateAgent ? (
                <>
                  <Button
                    loading={starterPending}
                    onClick={() => {
                      void directory.refetch();
                    }}
                  >
                    Retry
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void connection.ui.openTeamBilling()}
                  >
                    Open billing
                  </Button>
                </>
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
                  ? `${listVisible ? "Choose one from the list" : "Open the conversation list to choose one"}, or ask for something new. A short writing task is a good start.`
                  : "Ask anything."
              }
              actions={
                <>
                  {desktop || listed === 0 ? null : (
                    <Button
                      variant="outline"
                      aria-haspopup="dialog"
                      aria-controls="grove-nav"
                      aria-expanded={navOpen}
                      onClick={openNavigationSheet}
                    >
                      Agents and conversations
                    </Button>
                  )}
                  {canStart ? (
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
                  ) : null}
                </>
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
          <Conversation
            open={besideConversation}
            connection={connection}
            commands={besideRuntime}
            renderConversation={services.renderConversation}
            composeDraft={null}
            onPrefilled={() => undefined}
            onForked={(sessionId) => {
              besideOpener?.select(besideConversation.agentId, sessionId);
            }}
            onOpen={openBeside}
            models={appContext?.setup?.models}
            label="Beside conversation"
            agentName={agentById.get(besideConversation.agentId)?.name}
          />
        </section>
      )}
    </main>
  );
}
