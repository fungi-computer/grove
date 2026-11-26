import { failureMessage } from "@fungi.computer/agar/errors";
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
import { Button } from "@fungi.computer/caps/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
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
import { HeadLoading } from "./head-loading.js";
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

/** One opener: the short label on the button, and the full prompt it sends. */
export type PersonaChip = Readonly<{ label: string; prompt: string }>;

/** The openers an empty conversation offers; each sends its whole prompt. */
export const personaChips: readonly PersonaChip[] = [
  {
    label: "Set me up",
    // Short on purpose: it is the first bubble and the Inbox title. The starter
    // Agent's setup-fungi skill holds the interview, plan and approval script.
    prompt: "Set me up",
  },
  {
    label: "Help me set up my Oyster",
    prompt:
      "Help me set up my Oyster, Fungi running on my own machine. First ask what I'm installing it on (Mac, Linux, or a server). Then take me through the official install from docs.fungi.computer one step at a time. Give me one command, wait until I say it worked, then the next. Never guess a command. Finish by checking that my Oyster answers, and tell me what to do next.",
  },
  {
    label: "Make an image or video",
    prompt:
      "I want to make an image or a short video. Ask me what it's for and offer three style options to pick from. Then make a quick first draft in Prints and show it to me. After that, ask what to change. Save the style I like in your AGENTS.md so you remember it.",
  },
  {
    label: "Work on my code",
    prompt:
      "I want help with a code project. Ask for the repo link, or help me connect GitHub if it's private. Then clone it onto your Computer and read it: the README, build, test and CI files. Write an AGENTS.md for the project with the exact build and test commands, then tell me the three most useful things you learned and suggest one small first task.",
  },
];

export type ChatGillProps = Readonly<{
  connection: AppRoot | null;
  services?: InboxServices;
  /**
   * A Free Team's credit left, formatted by the host, such as "$1.00". Absent
   * on Pro, on Oyster, or when the host does not say; the widget then shows no
   * footer.
   */
  credit?: string | undefined;
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
        {personaChips.map(({ label, prompt }) => (
          <Button
            key={label}
            size="sm"
            variant="outline"
            onClick={() => {
              // The same path as typing it: the draft is the prompt, then it sends.
              composer.setDraft(prompt);
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

/**
 * The host knows no model is connected, so no Agent can reply yet. The one
 * step is the host's own Settings; when a key is added the host publishes
 * `models: "ready"` and the widget moves on to the chips by itself.
 */
function ChatGillConnectModel({
  agent,
  connection,
}: {
  agent: AppAgent | undefined;
  connection: AppRoot;
}) {
  const name = agent === undefined ? "your Agent" : agentLabel(agent);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const addKey = async () => {
    setFailed(false);
    setOpening(true);
    try {
      setFailed((await connection.ui.openSetup("model")) !== "opened");
    } catch (cause: unknown) {
      console.error("Grove chat widget could not open model setup", cause);
      setFailed(true);
    } finally {
      setOpening(false);
    }
  };
  return (
    <div
      className="chat-gill-connect m-auto flex min-h-0 max-w-[24rem] flex-col items-center gap-md overflow-y-auto px-md py-sm text-center"
      data-chat-gill-connect-model
    >
      {agent === undefined ? null : (
        <AgentHead
          avatar={agent.avatar}
          className="chat-gill-hero"
          name={name}
          size={72}
        />
      )}
      <h2 className="text-lg font-semibold text-base-content">
        Connect a model so {name} can reply
      </h2>
      <p className="text-sm text-dim">
        Use Cloudflare Workers AI, or a key from your own model provider. Your
        key stays on this Oyster.
      </p>
      <Button
        disabled={opening}
        onClick={() => {
          void addKey();
        }}
      >
        {opening ? "Opening Model keys…" : "Add a model key"}
      </Button>
      {failed ? (
        <FailureLine
          role="alert"
          message="Model keys could not open. Try opening them again."
          onRetry={() => {
            void addKey();
          }}
          onDismiss={() => {
            setFailed(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ChatGill({
  connection,
  services = defaultServices,
  credit,
  openFunding,
}: ChatGillProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const appContext = useAppContext(connection);
  // Only a host that says so: one that publishes nothing never shows this.
  const modelsMissing = appContext?.setup?.models === "missing";
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
  const [startFailure, setStartFailure] = useState(false);

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
      setStartFailure(false);
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
        setStartFailure(true);
        showConversationToast(connection.ui, {
          variant: "error",
          message: failureMessage(
            "The conversation could not be started",
            cause,
          ),
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
    if (!ready || !view || agent === undefined || !canWrite || modelsMissing)
      return;
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
    modelsMissing,
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
            message: failureMessage("Grove could not be opened", cause),
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
  // No Agent can reply without a model, so this step comes before any
  // conversation, including one opened before the host published the fact.
  const connectModel =
    modelsMissing && connection !== null && agent !== undefined && canWrite;

  let body: React.ReactNode;
  if (open) body = null;
  else if (!connection || directory.isPending || pending !== null || creating)
    body = (
      <HeadLoading
        agent={agent}
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
          {startFailure
            ? "The conversation could not be started."
            : snapshot.error !== null
              ? failureMessage(
                  "The conversation could not be started",
                  snapshot.error,
                )
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
      className="chat-gill @container/grove relative flex h-dvh min-h-0 flex-col bg-base-100 font-sans text-base-content"
      data-chat-gill
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
        {connectModel ? (
          <ChatGillConnectModel agent={headAgent} connection={connection} />
        ) : open ? (
          <Conversation
            key={`${open.agentId}:${open.sessionId}`}
            commands={commands}
            composeDraft={null}
            connection={connection}
            empty={<ChatGillEmpty agent={headAgent} />}
            label="Chat"
            loadingAgent={headAgent}
            agentName={headAgent?.name}
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
      {credit === undefined ? null : (
        <p
          className="flex-none px-md pb-sm text-center text-xs text-dim"
          data-chat-gill-footer
        >
          Credit: <strong className="font-semibold">{credit}</strong>
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
