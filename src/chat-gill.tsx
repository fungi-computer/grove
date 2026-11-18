import type { AppIdentity, AppRoot } from "@fungi.computer/agar";
import {
  agentManage,
  agentSessionWrite,
  type AppAgent,
} from "@fungi.computer/agar/agents";
import { appsOpen, type AppOpenInput } from "@fungi.computer/agar/apps";
import { queryKeys } from "@fungi.computer/agar/query";
import { appStorage } from "@fungi.computer/agar/storage";
import { useAppContext } from "@fungi.computer/agar/react";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import { Button } from "@fungi.computer/caps/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { AgentHead, useComposer } from "@fungi.computer/parakeet";
import {
  createConversationView,
  initialViewState,
  shownConversation,
  openingTarget,
  type ConversationViewSnapshot,
} from "@fungi.computer/parakeet/conversation-view";
import { createWhistle } from "@fungi.computer/whistle";
import { useQueryClient } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { showConversationToast } from "./conversation-toast.js";
import {
  Conversation,
  InboxApp,
  defaultServices,
  groveAgentAccess,
  sessionCreateRequests,
  withAgentClient,
  type InboxServices,
} from "./inbox.js";
import { agentLabel, buildInboxView } from "./inbox-model.js";
import { useInboxData } from "./queries.js";
import { firstSessionRequestId } from "./first-session.js";
import { useWebsiteInbox } from "./website-inbox.js";

/** The "what kind of person are you" openers; each sends as written. */
export const personaChips: readonly string[] = [
  "I write code",
  "I run a small business",
  "I make art and video",
  "Just looking around",
];

/**
 * What the host knows about who pays for this Team's Agent. Only the setup
 * credit shows in the widget; funded Teams and Oyster see nothing.
 */
export type ChatGillFunding =
  | Readonly<{ resourceFunding: "funded" | "unfunded" }>
  | Readonly<{
      resourceFunding: "setup";
      /** The credit left, formatted by the host, such as "$1.00". */
      setupCredit: string;
    }>;

export type ChatGillProps = Readonly<{
  connection: AppRoot | null;
  services?: InboxServices;
  /** Absent when the host does not say; the widget then shows no footer. */
  funding?: ChatGillFunding | undefined;
  /** Open the host's payment sheet over the dashboard. */
  openFunding?: (() => void) | undefined;
}>;

type OpenParams = Extract<
  AppOpenInput["intent"],
  { kind: "navigate" }
>["params"];

/** The request that opens full Grove at this conversation, or at its home. */
function openInGroveInput(
  identity: Pick<AppIdentity, "appId">,
  params: OpenParams,
): AppOpenInput {
  return { appId: identity.appId, intent: { kind: "navigate", params } };
}

/** The conversation's own address in Grove's navigate params. */
function conversationParams(
  conversation: Readonly<{ agentId: string; sessionId: string }>,
): OpenParams {
  return [
    { key: "agent", value: conversation.agentId },
    { key: "session", value: conversation.sessionId },
  ];
}

const emptySnapshot: ConversationViewSnapshot = {
  state: initialViewState,
  error: null,
};
const subscribeNothing = (): (() => void) => () => undefined;

/**
 * Which Grove this frame is. The host tells a surface tile its Gill through
 * the open params; any other frame is the full Grove window.
 */
export function GroveApp(props: ChatGillProps): React.JSX.Element {
  const context = useAppContext(props.connection);
  const request = context?.openRequest ?? null;
  const requested =
    request?.kind === "navigate"
      ? request.params.find((param) => param.key === "gill")?.value
      : undefined;
  // The request is only present on the launch; the frame keeps its kind.
  const [gill, setGill] = useState<string | null>(null);
  useEffect(() => {
    if (requested !== undefined) setGill(requested);
  }, [requested]);
  return (gill ?? requested) === "chat" ? (
    <ChatGillApp {...props} />
  ) : (
    <InboxApp
      connection={props.connection}
      {...(props.services === undefined ? {} : { services: props.services })}
    />
  );
}

export function ChatGillApp(props: ChatGillProps): React.JSX.Element {
  return (
    <ChatGill key={JSON.stringify(queryKeys.of(props.connection))} {...props} />
  );
}

/** The room the greeting needs for its large head; a shorter tile drops the head. */
const heroHeight = 260;

/** Whether the element has less height to use than the limit, in pixels. */
function useShorterThan(limit: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [short, setShort] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Test DOMs without layout have no ResizeObserver.
    const observer =
      "ResizeObserver" in globalThis
        ? new ResizeObserver(([entry]) => {
            setShort(entry.contentRect.height < limit);
          })
        : undefined;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
    };
  }, [limit]);
  return [ref, short] as const;
}

/** The persona chips and greeting an empty conversation shows. */
function ChatGillEmpty({ agent }: { agent: AppAgent | undefined }) {
  const composer = useComposer();
  const [space, short] = useShorterThan(heroHeight);
  const name = agent === undefined ? "your Agent" : agentLabel(agent);
  return (
    <div
      ref={space}
      className="chat-gill-empty flex h-full min-h-0 flex-col items-center justify-center gap-md overflow-y-auto px-md py-sm text-center"
    >
      {agent === undefined || short ? null : (
        <AgentHead
          avatar={agent.avatar}
          className="chat-gill-hero"
          name={name}
          size={72}
        />
      )}
      <h2 className="text-lg font-semibold text-base-content">
        Hi, I’m {name}. What brings you here?
      </h2>
      <div
        aria-label="What brings you here?"
        className="flex flex-wrap justify-center gap-sm"
        role="group"
      >
        {personaChips.map((label) => (
          <Button
            key={label}
            size="sm"
            variant="outline"
            onClick={() => {
              // The same path as typing it: the draft is the prompt, then it sends.
              composer.setDraft(label);
              composer.send();
            }}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ChatGill({
  connection,
  services = defaultServices,
  funding,
  openFunding,
}: ChatGillProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const appContext = useAppContext(connection);
  const { directory, inbox } = useInboxData(connection);
  const websites = useWebsiteInbox(connection, services);
  const commands = useMemo(() => createWhistle(), []);
  const agents = directory.data ?? [];
  // The Team owner's default Agent: the starter, or the first one they own.
  const agent = agents.find(
    (item) =>
      item.sessionOperations.includes("agent.read") &&
      item.sessionOperations.includes("agent.send") &&
      item.sessionOperations.includes("agent.manage"),
  );
  const canWrite = connection?.capabilities.has(agentSessionWrite) ?? false;
  const canManage = connection?.capabilities.has(agentManage) ?? false;
  const view = useMemo(
    () =>
      connection === null
        ? null
        : createConversationView({ connection, queryClient, services }),
    [connection, queryClient, services],
  );
  useEffect(
    () => () => {
      view?.close();
    },
    [view],
  );
  const snapshot = useSyncExternalStore(
    view?.subscribe ?? subscribeNothing,
    view?.snapshot ?? (() => emptySnapshot),
  );
  const open = shownConversation(snapshot.state);
  const pending = openingTarget(snapshot.state);
  const creating = snapshot.state.creating !== null;
  const [startFailed, setStartFailed] = useState(false);

  const latest = useMemo(() => {
    if (agent === undefined) return undefined;
    const websiteSessions = new Set(
      websites.rows.map(
        (row) => `${row.agentId}:${row.conversation.sessionId}`,
      ),
    );
    const rows = buildInboxView(
      agents,
      inbox.items.filter(
        (row) =>
          !("kind" in row) &&
          !websiteSessions.has(`${row.agentId}:${row.sessionId}`),
      ),
      agent.agentId,
    );
    return [...rows.active, ...rows.settled]
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .at(0);
  }, [agent, agents, inbox.items, websites.rows]);

  const startConversation = useCallback(
    async (cause: "person" | "auto") => {
      if (!connection || !view || agent === undefined) return;
      const request = view.create(cause);
      if (!request.accepted || request.ticket === null) return;
      setStartFailed(false);
      try {
        const generate = () => sessionCreateRequests.request.generate();
        // The automatic first conversation shares one request with Grove's
        // window, so the two frames never make two Sessions.
        const requestId =
          cause === "auto" && connection.capabilities.has(appStorage)
            ? await firstSessionRequestId(
                connection.capabilities.require(appStorage),
                generate,
              )
            : generate();
        const sessionId = await withAgentClient(
          connection,
          agent.agentId,
          services,
          (client) => client.createSession(requestId),
        );
        view.created(request.ticket, { agentId: agent.agentId, sessionId });
        // Creation can beat the visibility feed; reload the owner snapshot.
        inbox.refresh();
      } catch (cause: unknown) {
        view.createFailed(request.ticket);
        console.error(
          "Grove chat widget could not start a conversation",
          cause,
        );
        setStartFailed(true);
        showConversationToast(connection.ui, {
          variant: "error",
          message: "The conversation could not be started. Try again.",
        });
      }
    },
    [agent, connection, inbox.refresh, services, view],
  );

  // Show the most recent conversation, or make the first one; once per Agent.
  const attempted = useRef<string | null>(null);
  const ready =
    connection !== null &&
    !directory.isPending &&
    inbox.status !== "loading" &&
    inbox.status !== "error" &&
    !websites.loading;
  useEffect(() => {
    if (!ready || !view || agent === undefined || !canWrite) return;
    if (snapshot.state.view.kind !== "none" || creating) return;
    if (attempted.current === agent.agentId) return;
    attempted.current = agent.agentId;
    if (latest !== undefined)
      view.select(
        { agentId: agent.agentId, sessionId: latest.sessionId },
        "host",
      );
    else void startConversation("auto");
  }, [
    agent,
    canWrite,
    creating,
    latest,
    ready,
    snapshot.state.view.kind,
    startConversation,
    view,
  ]);

  const openInGrove = useCallback(
    (params: OpenParams) => {
      if (!connection) return;
      void (async () => {
        try {
          await connection.capabilities
            .require(appsOpen)
            .open(openInGroveInput(connection.identity, params));
        } catch (cause: unknown) {
          console.error("Grove chat widget could not open Grove", cause);
          showConversationToast(connection.ui, {
            variant: "error",
            message: "Grove could not be opened. Try again.",
          });
        }
      })();
    },
    [connection],
  );
  const canOpenGrove = connection?.capabilities.has(appsOpen) ?? false;
  const onForked = useCallback(
    (sessionId: string) => {
      if (!open || !view) return;
      view.select({ agentId: open.agentId, sessionId });
      inbox.refresh();
    },
    [inbox.refresh, open, view],
  );
  const headAgent =
    (open === null
      ? undefined
      : agents.find((item) => item.agentId === open.agentId)) ?? agent;
  const setup = funding?.resourceFunding === "setup" ? funding : undefined;

  let body: React.ReactNode;
  if (open) body = null;
  else if (!connection || directory.isPending || pending !== null || creating)
    body = (
      <LoadingState
        className="m-auto"
        framed={false}
        message={connection ? "Getting ready…" : "Connecting…"}
      />
    );
  else if (agents.length === 0 && canManage)
    // The Hub offers an owner their starter Agent while it reads the
    // directory, so an empty directory here means the starter was refused.
    body = (
      <div className="m-auto flex max-w-[24rem] flex-col items-center gap-sm px-md text-center">
        <p className="text-sm font-semibold">Shiitake isn’t ready yet</p>
        <p className="text-sm text-dim">
          Your first Agent couldn’t be set up. Try again, or check your Team’s
          credit.
        </p>
        <div className="flex flex-wrap justify-center gap-sm">
          <Button
            loading={directory.isFetching}
            size="sm"
            onClick={() => {
              void directory.refetch();
            }}
          >
            Try again
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void connection.ui.openTeamBilling().catch((cause: unknown) => {
                console.error(
                  "Grove chat widget could not open billing",
                  cause,
                );
              });
            }}
          >
            Open billing
          </Button>
        </div>
      </div>
    );
  else if (agent === undefined || !canWrite)
    body = (
      <div className="m-auto flex max-w-[24rem] flex-col items-center gap-sm px-md text-center">
        <p className="text-sm text-dim">
          Allow Grove to chat with your Agent here.
        </p>
        <Button
          size="sm"
          onClick={() => {
            void connection.ui
              .requestAppPermissions({ agents: groveAgentAccess })
              .catch((cause: unknown) => {
                console.error(
                  "Grove chat widget permission request failed",
                  cause,
                );
              });
          }}
        >
          Allow Agent access
        </Button>
      </div>
    );
  else
    body = (
      <div className="m-auto flex flex-col items-center gap-sm">
        <p className="text-sm text-dim">
          {startFailed || snapshot.error !== null
            ? "The conversation could not be started."
            : "No conversation is open."}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            void startConversation("person");
          }}
        >
          Start a conversation
        </Button>
      </div>
    );

  return (
    <main
      className="chat-gill @container/grove relative flex h-dvh min-h-0 flex-col bg-base-100 font-sans text-base-content data-[funding=setup]:[&_.parakeet-composer-model-key]:hidden"
      data-chat-gill
      data-funding={funding?.resourceFunding ?? "unknown"}
    >
      <header className="flex flex-none items-center gap-sm border-b border-base-300 px-md py-xs">
        {headAgent === undefined ? null : (
          <AgentHead
            avatar={headAgent.avatar}
            name={agentLabel(headAgent)}
            size={20}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {headAgent === undefined ? "Grove" : agentLabel(headAgent)}
        </span>
        <Button
          disabled={!canOpenGrove}
          size="xs"
          variant="ghost"
          onClick={() => {
            openInGrove(open === null ? [] : conversationParams(open));
          }}
        >
          Open in Grove
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton
                aria-label="Conversation options"
                icon={<Ellipsis />}
                size="sm"
              />
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={agent === undefined || !canWrite || creating}
              onSelect={() => {
                void startConversation("person");
              }}
            >
              New conversation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <section
        aria-label="Conversation"
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {open ? (
          <Conversation
            key={`${open.agentId}:${open.sessionId}`}
            commands={commands}
            composeDraft={null}
            connection={connection}
            empty={<ChatGillEmpty agent={headAgent} />}
            label="Chat"
            modelPicker={setup === undefined}
            models={appContext?.setup?.models}
            onForked={onForked}
            onOpen={(target) => {
              openInGrove(target.params);
            }}
            onPrefilled={() => undefined}
            open={open}
            opening={pending !== null}
            renderConversation={services.renderConversation}
          />
        ) : (
          body
        )}
      </section>
      {setup === undefined ? null : (
        <p
          className="flex-none px-md pb-sm text-center text-xs text-dim"
          data-chat-gill-footer
        >
          Setup credit:{" "}
          <strong className="font-semibold">{setup.setupCredit}</strong>
          {" · "}
          {openFunding === undefined ? (
            "Start Pro"
          ) : (
            <Button
              className="align-baseline"
              size="xs"
              variant="link"
              onClick={openFunding}
            >
              Start Pro
            </Button>
          )}
        </p>
      )}
    </main>
  );
}
