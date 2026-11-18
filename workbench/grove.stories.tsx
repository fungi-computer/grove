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
import { appStorage, type AppStorage } from "@fungi.computer/agar/storage";
import { appsOpen, type AppOpenInput } from "@fungi.computer/agar/apps";
import { ChatGillApp, type ChatGillFunding } from "../src/chat-gill.js";
import { InboxApp } from "../src/inbox.js";
import type { GroveLayout } from "../src/grove-layout.js";
import {
  createGroveFixture,
  type GroveScenario,
  publishedGameFixture,
} from "./fixtures.js";
import {
  createCapabilityRegistry,
  type AppOpenRequest,
  type AppRoot,
  type SetupState,
} from "@fungi.computer/agar";
import { useWorkbenchStatusBar } from "./status-bar.fixture.js";
import "@fungi.computer/parakeet/styles.css";

export default { title: "Grove" } satisfies StoryDefault;

function savedLayoutStorage(saved: GroveLayout): AppStorage {
  return {
    read: () =>
      Promise.resolve({
        value: saved,
        source: "member",
        team: null,
        member: { value: saved, revision: 1 },
        canWriteTeam: false,
      }),
    write: () => Promise.resolve({ revision: 2 }),
    reset: () => Promise.resolve({ revision: 2 }),
    claim: ({ value }) =>
      Promise.resolve({ value, revision: 2, claimed: true }),
    watch: () => Promise.reject(new Error("The workbench does not watch")),
  };
}

function withSavedLayout(
  base: AppRoot["capabilities"],
  saved: GroveLayout,
): AppRoot["capabilities"] {
  const registry = createCapabilityRegistry();
  registry.provide(appStorage, savedLayoutStorage(saved));
  return {
    version: base.version,
    subscribe: (listener) => base.subscribe(listener),
    has: (contract) => registry.has(contract) || base.has(contract),
    require: (contract) =>
      registry.has(contract)
        ? registry.require(contract)
        : base.require(contract),
  };
}

/** The host answers "Open in Grove" by reporting what it was asked to open. */
function withOpenApp(
  base: AppRoot["capabilities"],
  open: (input: AppOpenInput) => void,
): AppRoot["capabilities"] {
  const registry = createCapabilityRegistry();
  registry.provide(appsOpen, {
    open: (input) => {
      open(input);
      return Promise.resolve();
    },
    role: () => Promise.resolve({ displayName: "Grove" }),
  });
  return {
    version: base.version,
    subscribe: (listener) => base.subscribe(listener),
    has: (contract) => registry.has(contract) || base.has(contract),
    require: (contract) =>
      registry.has(contract)
        ? registry.require(contract)
        : base.require(contract),
  };
}

/** What the dashboard tile of Grove's chat shows; absent, the full window. */
type ChatTile = Readonly<{
  /** M is the compact ask box, L the full timeline. */
  size: "M" | "L";
  funding?: ChatGillFunding;
}>;

function Workbench({
  scenario = "inbox",
  narrow = false,
  tile = false,
  chat,
  openRequest = null,
  unavailableSessionIds = [],
  models,
  keyConnects,
  openBilling,
  savedLayout,
}: {
  scenario?: GroveScenario;
  narrow?: boolean;
  tile?: boolean;
  chat?: ChatTile;
  openRequest?: AppOpenRequest | null;
  unavailableSessionIds?: readonly string[];
  /** The host's setup fact; omit for a host that does not say. */
  models?: SetupState;
  /** Whether adding a key in Settings connects a model. */
  keyConnects?: boolean;
  openBilling?: () => Promise<void>;
  /** The member's rail layout the host App storage already holds. */
  savedLayout?: GroveLayout;
}) {
  const [fixture] = useState(() =>
    createGroveFixture(
      scenario,
      openRequest,
      unavailableSessionIds,
      models,
      openBilling,
      keyConnects,
    ),
  );
  const { status, bar } = useWorkbenchStatusBar();
  const [opened, setOpened] = useState<AppOpenInput | null>(null);
  const [fundingOpened, setFundingOpened] = useState(false);
  const connection = useMemo(
    () =>
      fixture.connection === null
        ? null
        : {
            ...fixture.connection,
            capabilities: withOpenApp(
              savedLayout === undefined
                ? fixture.connection.capabilities
                : withSavedLayout(fixture.connection.capabilities, savedLayout),
              setOpened,
            ),
            ui: { ...fixture.connection.ui, ...status },
          },
    [fixture, status, savedLayout],
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
    return mountApp(element, { name: "Grove", queryClient }, () =>
      chat === undefined ? (
        <InboxApp {...fixture} connection={connection} />
      ) : (
        <ChatGillApp
          {...fixture}
          connection={connection}
          funding={chat.funding}
          openFunding={() => {
            setFundingOpened(true);
          }}
        />
      ),
    );
  }, [fixture, connection, queryClient, chat]);
  return (
    <div
      className={`mx-auto w-full ${narrow ? "max-w-[24rem]" : chat?.size === "L" ? "max-w-[36rem]" : tile || chat ? "max-w-[30.625rem]" : "max-w-[76rem]"}`}
    >
      <div
        className={`flex flex-col ${tile || chat?.size === "M" ? "h-[20.625rem]" : chat?.size === "L" && !narrow ? "h-[36rem]" : "h-[calc(100dvh-2*var(--spacing-xl))] min-h-96"}`}
        data-theme={theme}
      >
        <div
          className="min-h-0 flex-1 [&_[data-chat-gill]]:h-full [&_[data-inbox-app]]:h-full"
          style={{ contain: "layout" }}
          ref={root}
        />
        {bar}
      </div>
      {opened === null ? null : (
        <p role="status" data-opened-grove>
          Grove opened:{" "}
          {opened.intent.kind === "navigate"
            ? opened.intent.params
                .map((param) => `${param.key}=${param.value}`)
                .join(" ")
            : "compose"}
        </p>
      )}
      {fundingOpened ? <p role="status">Funding sheet opened</p> : null}
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
/** A saved hidden conversation list must still offer a way back. */
export const ListHiddenSaved = () => (
  <Workbench
    savedLayout={{ agentRailOpen: true, listRailOpen: false, listWidth: 320 }}
  />
);
export const Websites = () => <Workbench scenario="websites" />;
export const WebsitesHeld = () => <Workbench scenario="websites-held" />;
export const WebsitesCollision = () => (
  <Workbench scenario="websites-collision" />
);
export const ThousandConversations = () => <Workbench scenario="thousand" />;
export const Narrow = () => <Workbench narrow />;
/** A third of a tiled desktop: a wide screen around a 490x330 Grove window. */
export const Tile = () => <Workbench tile />;
/** A tile too short for the setup steps: the setup card scrolls. */
export const TileNoModel = () => (
  <Workbench tile scenario="no-agents" models="missing" />
);
/** Grove's chat as a dashboard tile (a surface Gill): no conversations yet. */
export const ChatGillEmpty = () => (
  <Workbench scenario="starter" models="ready" chat={{ size: "L" }} />
);
/** The same tile mid-conversation, its newest turn still running. */
export const ChatGillLive = () => (
  <Workbench models="ready" chat={{ size: "L" }} />
);
/** Under the Team's setup credit: the footer shows and the model picker hides. */
export const ChatGillSetupFooter = () => (
  <Workbench
    scenario="starter"
    models="ready"
    chat={{
      size: "L",
      funding: { resourceFunding: "setup", setupCredit: "$1.00" },
    }}
  />
);
/**
 * An Oyster with no model yet (`oyster try` on a laptop): the tile leads to
 * Model keys, and adding a key moves it on to the greeting and chips.
 */
export const ChatGillNoModel = () => (
  <Workbench
    scenario="starter"
    models="missing"
    keyConnects
    chat={{ size: "L" }}
  />
);
/** The tile on a phone, where it fills the viewport. */
export const ChatGillPhone = () => (
  <Workbench
    narrow
    scenario="starter"
    models="ready"
    chat={{
      size: "L",
      funding: { resourceFunding: "setup", setupCredit: "$1.00" },
    }}
  />
);
/** The compact ask box: a short tile shows the greeting without the large head. */
export const ChatGillCompact = () => (
  <Workbench scenario="starter" models="ready" chat={{ size: "M" }} />
);
/**
 * The dashboard tile and the full window of one Grove, open on the same
 * Session: a turn sent from the tile shows in the window as it streams.
 */
export function ChatGillWithWindow() {
  const [fixture] = useState(() =>
    createGroveFixture(
      "two-frames",
      {
        kind: "navigate",
        requestId: "chat-gill-with-window",
        params: [
          { key: "agent", value: "gardener" },
          { key: "session", value: "gardener-0" },
        ],
      },
      [],
      "ready",
    ),
  );
  const tile = useRef<HTMLDivElement>(null);
  const window = useRef<HTMLDivElement>(null);
  const theme = useSyncExternalStore(
    (onChange) =>
      fixture.connection?.theme.subscribe(onChange) ?? (() => undefined),
    () => fixture.connection?.theme.get(),
  );
  useEffect(() => {
    const tileElement = tile.current;
    const windowElement = window.current;
    if (!tileElement || !windowElement)
      throw new Error("Grove workbench mount is missing");
    // Each frame is its own document in the host, so each has its own cache.
    const stopTile = mountApp(
      tileElement,
      { name: "Grove", queryClient: createQueryClient() },
      () => <ChatGillApp {...fixture} />,
    );
    const stopWindow = mountApp(
      windowElement,
      { name: "Grove", queryClient: createQueryClient() },
      () => <InboxApp {...fixture} />,
    );
    return () => {
      stopTile();
      stopWindow();
    };
  }, [fixture]);
  return (
    <div
      className="mx-auto flex h-[calc(100dvh-2*var(--spacing-xl))] min-h-96 w-full max-w-[90rem] gap-md"
      data-theme={theme}
    >
      <div
        className="h-full w-[36rem] flex-none [&_[data-chat-gill]]:h-full"
        data-frame="tile"
        ref={tile}
        style={{ contain: "layout" }}
      />
      <div
        className="h-full min-w-0 flex-1 [&_[data-inbox-app]]:h-full"
        data-frame="window"
        ref={window}
        style={{ contain: "layout" }}
      />
    </div>
  );
}
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
export const ForkFromMessage = () => <Conversation scenario="fork" />;
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
/** A model is connected and nothing is open yet: Grove opens a conversation. */
export const FirstRunReady = () => (
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

/**
 * A running command's output tail. The frames are the real session frames the
 * Hub's Agent sent while a command ran on its Computer (captured by
 * apps/hub test:grove-live-output); the proof steps them one at a time.
 */
export const LiveToolOutput = () => (
  <Workbench
    scenario="live-tool-output"
    models="ready"
    openRequest={{
      kind: "navigate",
      requestId: "grove-live-tool-output",
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
