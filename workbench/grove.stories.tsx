import { msw, type Story, type StoryDefault } from "@ladle/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { mountApp } from "@fungi.computer/agar/react";
import { createQueryClient } from "@fungi.computer/agar/query";
import { InboxApp } from "../src/inbox.js";
import {
  createGroveFixture,
  type GroveScenario,
  publishedGameFixture,
} from "./fixtures.js";
import type { AppOpenRequest, SetupState } from "@fungi.computer/agar";
import { useWorkbenchStatusBar } from "./status-bar.fixture.js";
import "@fungi.computer/parakeet/styles.css";

export default { title: "Grove" } satisfies StoryDefault;

function Workbench({
  scenario = "inbox",
  narrow = false,
  openRequest = null,
  unavailableSessionIds = [],
  models,
  openBilling,
}: {
  scenario?: GroveScenario;
  narrow?: boolean;
  openRequest?: AppOpenRequest | null;
  unavailableSessionIds?: readonly string[];
  /** The host's setup fact; omit for a host that does not say. */
  models?: SetupState;
  openBilling?: () => Promise<void>;
}) {
  const [fixture] = useState(() =>
    createGroveFixture(
      scenario,
      openRequest,
      unavailableSessionIds,
      models,
      openBilling,
    ),
  );
  const { status, bar } = useWorkbenchStatusBar();
  const connection = useMemo(
    () =>
      fixture.connection === null
        ? null
        : {
            ...fixture.connection,
            ui: { ...fixture.connection.ui, ...status },
          },
    [fixture, status],
  );
  const theme = useSyncExternalStore(
    (onChange) =>
      fixture.connection?.theme.subscribe(onChange) ?? (() => undefined),
    () => fixture.connection?.theme.get(),
  );
  const [queryClient] = useState(createQueryClient);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) throw new Error("Grove workbench mount is missing");
    return mountApp(element, { name: "Grove", queryClient }, () => (
      <InboxApp {...fixture} connection={connection} />
    ));
  }, [fixture, connection, queryClient]);
  return (
    <div
      className={`mx-auto w-full ${narrow ? "max-w-[24rem]" : "max-w-[76rem]"}`}
    >
      <div
        className="flex h-[calc(100dvh-2*var(--spacing-xl))] min-h-96 flex-col"
        data-theme={theme}
      >
        <div
          className="min-h-0 flex-1 [&_[data-inbox-app]]:h-full"
          style={{ contain: "layout" }}
          ref={root}
        />
        {bar}
      </div>
    </div>
  );
}

export const Inbox = () => <Workbench />;
/** A read-only model label must yield to the phone composer's Send key. */
export const LongModel = () => <Workbench scenario="long-model" />;
/** A host-admitted Agent catalog powers the pane's one /model picker. */
export const ModelPicker = () => (
  <Workbench
    scenario="model-picker"
    openRequest={{
      kind: "navigate",
      requestId: "model-picker-preview",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gardener-1" },
      ],
    }}
  />
);
export const CommandRetry = () => <Workbench scenario="command-retry" />;
/** An open conversation streams while a foreign Session gains attention. */
export const StableInbox = () => (
  <Workbench
    scenario="stable-inbox"
    openRequest={{
      kind: "navigate",
      requestId: "stable-inbox-preview",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gardener-1" },
      ],
    }}
  />
);
export const Websites = () => <Workbench scenario="websites" />;
export const WebsitesHeld = () => <Workbench scenario="websites-held" />;
export const WebsitesCollision = () => (
  <Workbench scenario="websites-collision" />
);
export const ThousandConversations = () => <Workbench scenario="thousand" />;
export const Narrow = () => <Workbench narrow />;
export const Loading = () => <Workbench scenario="loading" />;
export const EmptyConversations = () => <Workbench scenario="empty" />;
export const FailedStart = () => <Workbench scenario="start-failed" />;
export const FailedStartOpen = () => (
  <Conversation scenario="start-failed-open" />
);
export const SellerClosed = () => <Workbench scenario="seller-closed" />;
export const SafetyNotice = () => <Workbench scenario="safety-notice" />;
export const NoAgents = () => <Workbench scenario="no-agents" />;
export const NoAgentAccess = () => <Workbench scenario="no-agent-access" />;
export const DirectoryRetry = () => <Workbench scenario="unavailable" />;
export const InboxRetry = () => <Workbench scenario="inbox-retry" />;
export const LiveUpdates = () => <Workbench scenario="live" />;
export const RowStates = () => <Workbench scenario="row-states" />;
export const FailedOpen = () => <Workbench scenario="open-error" />;
export const FailedBaseline = () => <Workbench scenario="baseline-error" />;
export const Disconnected = () => <Workbench scenario="disconnected" />;
export const DeepLink = () => (
  <Workbench
    openRequest={{
      kind: "navigate",
      requestId: "grove-browser-open-session",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gardener-1" },
      ],
    }}
  />
);
export const SubAgents = () => (
  <Workbench
    scenario="subagents"
    openRequest={{
      kind: "navigate",
      requestId: "grove-browser-open-subagents",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gardener-1" },
      ],
    }}
  />
);
export const MissingSession = () => (
  <Workbench
    openRequest={{
      kind: "navigate",
      requestId: "grove-browser-missing-session",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gone-session" },
      ],
    }}
    unavailableSessionIds={["gone-session"]}
  />
);
export const PublishedGame: Story = () => (
  <Workbench
    scenario="published-game"
    openRequest={{
      kind: "navigate",
      requestId: "grove-published-game",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gardener-1" },
      ],
    }}
  />
);

/** An active turn plus two queued messages, with a slow cancellation reply. */
export const QueuedCancel = () => <Conversation scenario="queued-cancel" />;

/** Paused owner queue for native browser recall and edited-resend proof. */
export const QueuedRecall = () => (
  <Workbench
    scenario="queued-recall"
    openRequest={{
      kind: "navigate",
      requestId: "grove-recall",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gardener-1" },
      ],
    }}
  />
);

/** The retained pre-sides conversation, reviewed in light and dark. */
export const SimpleTimeline = () => (
  <Workbench
    scenario="timeline"
    openRequest={{
      kind: "navigate",
      requestId: "grove-timeline",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gardener-1" },
      ],
    }}
  />
);

/** A Prints panel in chat: the picture inline and Open in Prints below it. */
export const PrintsPanel = () => (
  <Workbench
    scenario="prints-panel"
    openRequest={{
      kind: "navigate",
      requestId: "grove-prints-panel",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gardener-1" },
      ],
    }}
  />
);

/** One of each owner state in the list; the rest seen. */
export const OwnerStates = () => <Workbench scenario="owner-states" />;
/** The same states beside an open conversation. */
export const OwnerStatesConversation = () => (
  <Workbench
    scenario="owner-states"
    openRequest={{
      kind: "navigate",
      requestId: "grove-owner-states-conversation",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gardener-1" },
      ],
    }}
  />
);
/** Many rows waiting, failed, finished and working across three Agents. */
export const ManyWaiting = () => <Workbench scenario="many-waiting" />;
/** Everything seen and nothing running: no badges. */
export const AllClear = () => <Workbench scenario="all-clear" />;
PublishedGame.msw = [
  msw.http.get("https://games.example.test/api/games/tiny-frog-hop", () =>
    msw.HttpResponse.json({ game: publishedGameFixture }),
  ),
];

function Conversation({
  scenario = "inbox",
  sessionId = "gardener-1",
}: {
  scenario?: GroveScenario;
  sessionId?: string;
}) {
  return (
    <Workbench
      scenario={scenario}
      openRequest={{
        kind: "navigate",
        requestId: `grove-${scenario}`,
        params: [
          { key: "agent", value: "gardener" },
          { key: "session", value: sessionId },
        ],
      }}
    />
  );
}
export const ConversationReply = () => <Conversation />;
export const AdmissionRetry = () => <Conversation scenario="admission-retry" />;
/** A completed Session while the bulk inbox still reports the previous run. */
export const ConversationAnsweredInboxLag = () => (
  <Conversation scenario="conversation-answered-inbox-lag" />
);
export const ConversationThinking = () => (
  <Conversation sessionId="gardener-0" />
);
export const ConversationQueued = () => (
  <Conversation scenario="conversation-queued" />
);
export const ConversationEmpty = () => (
  <Conversation scenario="conversation-empty" />
);
export const ConversationLoading = () => (
  <Conversation scenario="conversation-loading" />
);
export const ConversationUnavailable = () => (
  <Conversation scenario="conversation-unavailable" />
);
export const ConversationFailed = () => (
  <Conversation scenario="conversation-failed" />
);
export const FailedTurnRetry = () => (
  <Conversation scenario="failed-turn-retry" />
);
export const ConversationInterrupted = () => (
  <Conversation scenario="conversation-interrupted" />
);
export const ConversationCancelled = () => (
  <Conversation scenario="conversation-cancelled" />
);

/** First run, no model: the purpose line and the one fix. */
export const FirstRunNoModel = () => (
  <Workbench scenario="no-agents" models="missing" />
);
/** An Agent exists but no model is connected. */
export const AgentNoModel = () => (
  <Workbench scenario="empty" models="missing" />
);
/** Returning with saved conversations still requires model setup. */
export const ReturnVisitNoModel = () => <Workbench models="missing" />;
/** A model is connected: three starters that send. */
export const FirstRunStarters = () => (
  <Workbench scenario="empty" models="ready" />
);
/** Inside a conversation with no model: one central setup panel replaces sending. */
export const ConversationNoModel = () => (
  <Workbench
    scenario="conversation-empty"
    models="missing"
    openRequest={{
      kind: "navigate",
      requestId: "grove-conversation-empty",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gardener-1" },
      ],
    }}
  />
);

/** Losing a model keeps saved conversation history and one setup action. */
export const ConversationHistoryNoModel = () => (
  <Workbench
    models="missing"
    openRequest={{
      kind: "navigate",
      requestId: "grove-history-no-model",
      params: [
        { key: "agent", value: "gardener" },
        { key: "session", value: "gardener-1" },
      ],
    }}
  />
);

/** A real funding refusal keeps the creation draft and delegates Billing to its host. */
export function UnfundedTeam() {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Workbench
        scenario="unfunded"
        openBilling={() => {
          setOpened(true);
          return Promise.resolve();
        }}
      />
      {opened ? <p role="status">Billing opened</p> : null}
    </>
  );
}
