import { seededAvatar } from "@fungi.computer/sprite/avatar";
import {
  inertHostNavigation,
  createCapabilityRegistry,
  type AppOpenRequest,
  type AppRoot,
  type ReadonlyStore,
} from "@fungi.computer/agar";
import type { GameSharePreview } from "../src/game-share-card.js";
import {
  agentAvatar,
  agentManage,
  agentList,
  agentSessionWrite,
  type AppAgent,
} from "@fungi.computer/agar/agents";
import type { MemberInboxSession } from "@fungi.computer/agar/inbox";
import {
  channelsRead,
  channelsPersonalManage,
  type AppWebsiteConversation,
} from "@fungi.computer/agar/channels";
import type {
  AbortCommand,
  Accepted,
  BranchCommand,
  CancelCommand,
  CancelResult,
  ForkCommand,
  ForkedSession,
  OperatorCommand,
  CompactCommand,
  TitleCommand,
  PromptCommand,
  SessionCommand,
  SessionFrame,
  SessionSnapshot,
  ShiitakeSession,
} from "@fungi.computer/shiitake/client";
import {
  gardenCall,
  gardenExtensionId,
  gardenSlots,
  idleActivity,
  queuedActivity,
  runningActivity,
} from "@fungi.computer/parakeet-testing";
import {
  subagentsContract,
  SubagentsProjection,
} from "@fungi.computer/shiitake-extensions/subagents";
import * as Schema from "effect/Schema";
import type { InboxServices } from "../src/inbox.js";
import { createFixtureMemberInbox } from "./member-inbox-fixture.js";

/** The footer view of one conversation that sent work to two Agents and created a third. */
const subagentSlots = {
  [subagentsContract.id]: {
    status: "running" as const,
    revision: "sha256:grove-subagents-fixture",
    value: Schema.encodeSync(SubagentsProjection)({
      agents: [
        {
          agentId: "librarian",
          name: "Librarian",
          sessionId: "librarian-0",
          state: "working",
        },
        {
          agentId: "maker",
          name: "Maker",
          sessionId: "maker-0",
          state: "waiting",
          attention: "Approve files.write",
        },
        {
          agentId: "scout",
          name: "Scout",
          sessionId: null,
          state: "idle",
        },
      ],
      more: 0,
    }),
  },
};

export const publishedGameFixture = {
  title: "Tiny Frog Hop",
  summary: "Hop between lily pads and collect fireflies in a tiny pond game.",
  coverUrl: null,
  shareUrl: "https://games.example.test/tiny-frog-hop",
} satisfies GameSharePreview;

export type GroveScenario =
  | "timeline"
  | "websites"
  | "websites-held"
  | "websites-collision"
  | "inbox"
  | "safety-notice"
  | "seller-closed"
  | "thousand"
  | "start-failed"
  | "empty"
  | "no-agents"
  | "no-agent-access"
  | "loading"
  | "unavailable"
  | "inbox-retry"
  | "row-states"
  | "live"
  | "stable-inbox"
  | "open-error"
  | "baseline-error"
  | "disconnected"
  | "published-game"
  | "owner-states"
  | "many-waiting"
  | "all-clear"
  | "conversation-answered-inbox-lag"
  | "conversation-empty"
  | "conversation-loading"
  | "conversation-unavailable"
  | "conversation-queued"
  | "conversation-failed"
  | "conversation-interrupted"
  | "conversation-cancelled"
  | "subagents";

type ListState = "needs_you" | "running" | "errored" | "unseen";

/**
 * Owner states for the two-rail list scenarios, by Session. Every other settled
 * row in such a scenario was visited after it settled, so it is not unseen.
 */
const listStates = new Map<GroveScenario, ReadonlyMap<string, ListState>>([
  [
    "owner-states",
    new Map<string, ListState>([
      ["maker-0", "needs_you"],
      ["librarian-0", "errored"],
      ["gardener-0", "running"],
      ["gardener-2", "unseen"],
    ]),
  ],
  [
    "many-waiting",
    new Map<string, ListState>([
      ["gardener-1", "needs_you"],
      ["librarian-1", "needs_you"],
      ["maker-1", "needs_you"],
      ["maker-3", "needs_you"],
      ["librarian-0", "errored"],
      ["maker-0", "errored"],
      ["gardener-0", "running"],
      ["librarian-2", "running"],
      ["gardener-2", "unseen"],
      ["gardener-3", "unseen"],
      ["librarian-3", "unseen"],
      ["maker-2", "unseen"],
    ]),
  ],
  ["all-clear", new Map<string, ListState>()],
  ["stable-inbox", new Map<string, ListState>()],
]);

type PreviewStatus = "idle" | "thinking" | "queued";

const titles = [
  "A planting plan for the courtyard",
  "Spring notes, collected",
  "Sketching the seed library",
  "The next small experiment",
  "A quiet corner for ferns",
  "The seed-library notes",
];

const store = <T>(initial: T) => {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    subscribe: (listener: (value: T) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (next: T) => {
      value = next;
      for (const listener of listeners) listener(value);
    },
  } satisfies { update(value: T): void } & ReadonlyStore<T>;
};
const unsupported = () =>
  Promise.reject(
    new Error("This local preview has no provider. No request was sent."),
  );

/**
 * The workbench provider owns the light/dark toggle and writes the active
 * theme on <body>. The fixture's host theme is that attribute, observed only
 * while something subscribes, so Grove can be reviewed in both.
 */
const workbenchTheme = () => {
  const read = () => globalThis.document.body.dataset.theme ?? "latte";
  return {
    get: read,
    subscribe: (listener: (value: string) => void) => {
      const observer = new MutationObserver(() => {
        listener(read());
      });
      observer.observe(globalThis.document.body, {
        attributeFilter: ["data-theme"],
        attributes: true,
      });
      return () => {
        observer.disconnect();
      };
    },
  } satisfies ReadonlyStore<string>;
};

/**
 * The preview has no owner: it takes no commands, and its waiting work has
 * always "already started", so a cancel gets the owner's typed too-late answer.
 */
function previewCommand(
  input: PromptCommand | CompactCommand,
): Promise<Accepted>;
function previewCommand(input: CancelCommand): Promise<CancelResult>;
function previewCommand(
  input: AbortCommand | BranchCommand | OperatorCommand | TitleCommand,
): Promise<undefined>;
function previewCommand(input: ForkCommand): Promise<ForkedSession>;
function previewCommand(
  input: SessionCommand,
): Promise<Accepted | CancelResult | ForkedSession | undefined>;
function previewCommand(
  input: SessionCommand,
): Promise<Accepted | CancelResult | ForkedSession | undefined> {
  return input.type === "cancel"
    ? Promise.resolve({ status: "too_late", commandId: input.commandId })
    : unsupported();
}

/** Real Parakeet consumes this read-only Session; no replacement timeline. */
function previewSession(
  sessionId: string,
  status: PreviewStatus,
  scenario: GroveScenario,
  onTurn?: (state: "running" | "done", at: number) => void,
): ShiitakeSession {
  const index = Number(sessionId.slice(sessionId.lastIndexOf("-") + 1));
  const publishedGame =
    scenario === "published-game" && sessionId === "gardener-1";
  const prompt =
    scenario === "websites" ||
    scenario === "websites-held" ||
    scenario === "websites-collision"
      ? "Hi, can someone help me choose the right consulting plan?"
      : publishedGame
        ? "Make me a tiny game about a frog"
        : (titles[index] ?? "Grove demo prompt");
  const commandId = `preview-command-${sessionId}`;
  const settled =
    status === "idle" &&
    ![
      "conversation-failed",
      "conversation-interrupted",
      "conversation-cancelled",
    ].includes(scenario);
  let snapshot: SessionSnapshot = {
    sessionId,
    cursor: "preview:1",
    hasMore: false,
    messages:
      scenario === "conversation-empty"
        ? []
        : [
            {
              id: "preview-user",
              sequence: 1,
              commandId,
              value: {
                role: "user",
                content: prompt,
                timestamp: Date.now(),
              },
            },
            ...(settled
              ? [
                  {
                    id: "preview-assistant",
                    sequence: 2,
                    commandId: null,
                    value: {
                      role: "assistant",
                      api: "pi",
                      provider:
                        scenario === "conversation-answered-inbox-lag"
                          ? "openai"
                          : "camel",
                      model:
                        scenario === "conversation-answered-inbox-lag"
                          ? "openai/gpt-6-luna"
                          : "auto",
                      content: [
                        {
                          type: "text",
                          text: publishedGame
                            ? `I built and checked your frog game.\n\nPublished ${publishedGameFixture.title} @sha256:demo\nShare: ${publishedGameFixture.shareUrl}`
                            : scenario === "websites" ||
                                scenario === "websites-held" ||
                                scenario === "websites-collision"
                              ? "Of course. I'll bring in a teammate to help with your plans and pricing."
                              : `${prompt} Grove demo complete.`,
                        },
                      ],
                      stopReason: "stop",
                      timestamp: Date.now(),
                      usage: {
                        input: 1,
                        output: 1,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 2,
                        cost: {
                          input: 0,
                          output: 0,
                          cacheRead: 0,
                          cacheWrite: 0,
                          total: 0,
                        },
                      },
                    },
                  } satisfies SessionSnapshot["messages"][number],
                ]
              : []),
          ],
    terminals:
      scenario === "conversation-failed"
        ? [
            {
              commandId,
              outcome: "failed",
              sequence: 2,
              diagnostic:
                "The image provider is unavailable. Your prompt is preserved.",
            },
          ]
        : scenario === "conversation-interrupted"
          ? [
              {
                commandId,
                outcome: "interrupted",
                sequence: 2,
                diagnostic: "The connection ended before the run finished.",
              },
            ]
          : scenario === "conversation-cancelled"
            ? [
                {
                  commandId,
                  outcome: "cancelled",
                  sequence: 2,
                  diagnostic: null,
                },
              ]
            : settled && scenario !== "conversation-empty"
              ? [
                  {
                    commandId,
                    outcome: "completed",
                    sequence: 2,
                    diagnostic: null,
                  },
                ]
              : [],
    pending: { total: 0, prompts: [], hasMore: false },
    // Mirror the owner: a settled Session has its reply and reads idle; work
    // in play has only its prompt so far.
    activity:
      status === "idle"
        ? idleActivity
        : status === "queued"
          ? queuedActivity(`preview-queued-${sessionId}`)
          : runningActivity(),
    progress: null,
    attention: [],
    // A test extension advertises `/water`; Grove names no command itself.
    extensions:
      scenario === "subagents" && sessionId === "gardener-1"
        ? { ...gardenSlots(), ...subagentSlots }
        : gardenSlots(),
  };
  if (
    scenario === "websites" ||
    scenario === "websites-held" ||
    scenario === "websites-collision"
  ) {
    const reply = snapshot.messages.find(
      (message) => message.value.role === "assistant",
    )?.value;
    if (reply?.role !== "assistant")
      throw new Error("Website fixture needs a settled reply");
    snapshot = {
      ...snapshot,
      messages: [
        ...snapshot.messages,
        {
          id: "preview-operator",
          sequence: 3,
          commandId: null,
          meta: {
            author: {
              id:
                scenario === "websites-collision" ? "user_ada_one" : "user_ada",
              name: "Ada",
            },
          },
          value: {
            ...reply,
            api: "operator",
            provider: "operator",
            model: "",
            content: [
              {
                type: "text",
                text: "Hi, I'm Ada. I can help you choose the right plan.",
              },
            ],
          },
        },
      ],
    };
    if (scenario === "websites-collision") {
      const first = snapshot.messages.at(-1);
      if (!first) throw new Error("Website operator fixture missing");
      snapshot = {
        ...snapshot,
        messages: [
          ...snapshot.messages,
          {
            ...first,
            id: "preview-second-operator",
            sequence: 4,
            meta: { author: { id: "user_ada_two", name: "Ada" } },
            value: {
              ...reply,
              api: "operator",
              provider: "operator",
              model: "",
              content: [
                {
                  type: "text",
                  text: "Hi, I'm Ada too. I'll help with your timeline.",
                },
              ],
            },
          },
        ],
      };
    }
  }
  if (scenario === "timeline" && sessionId === "gardener-1") {
    const reply = snapshot.messages.find(
      (message) => message.value.role === "assistant",
    )?.value;
    if (reply?.role !== "assistant")
      throw new Error("Timeline fixture needs a settled reply");
    const user = (
      id: string,
      sequence: number,
      text: string,
    ): SessionSnapshot["messages"][number] => ({
      id,
      sequence,
      commandId: `command-${id}`,
      value: { role: "user", content: text, timestamp: Date.now() },
    });
    const assistant = (
      id: string,
      sequence: number,
      text: string,
      thinking: string,
    ): SessionSnapshot["messages"][number] => ({
      id,
      sequence,
      commandId: null,
      value: {
        ...reply,
        content: [
          { type: "thinking", thinking },
          { type: "text", text },
        ],
      },
    });
    const messages: SessionSnapshot["messages"] = [
      user(
        "courtyard",
        1,
        "Can you plan a planting layout for the courtyard? It gets morning sun and is shady after 2pm.",
      ),
      assistant(
        "notes",
        2,
        "Let me read the courtyard notes first so the plan fits the beds you have.",
        "Check the existing beds and match the afternoon shade.",
      ),
      {
        id: "read-call",
        sequence: 3,
        commandId: null,
        value: {
          ...reply,
          content: [
            {
              type: "toolCall",
              id: "read-notes",
              name: "read",
              arguments: { path: "notes/courtyard.md" },
            },
          ],
        },
      },
      {
        id: "read-result",
        sequence: 4,
        commandId: null,
        value: {
          role: "toolResult",
          toolCallId: "read-notes",
          toolName: "read",
          content: [
            {
              type: "text",
              text: "Two raised beds, a shaded north wall, and clay soil.",
            },
          ],
          isError: false,
          timestamp: Date.now(),
        },
      },
      {
        id: "layout",
        sequence: 5,
        commandId: null,
        value: {
          ...reply,
          content: [
            {
              type: "text",
              text: "Here is a layout for the two raised beds:\n\n- **North bed (against the wall):** ferns, hostas and astilbe, which like the cool afternoon shade.\n- **South bed:** foxgloves at the back, heuchera and hardy geraniums in front.\n\nClay loam drains slowly, so I would mix in grit before planting.",
            },
          ],
        },
      },
      user(
        "flowers",
        6,
        "Nice. Can you add something that flowers in late summer?",
      ),
      assistant(
        "summer",
        7,
        "Add **Japanese anemones** to the south bed: they flower from August to October and are happy in part shade.\n\nToad lilies would suit the north bed too.",
        "Choose late flowers that tolerate shade.",
      ),
    ];
    const terminals: SessionSnapshot["terminals"] = [
      {
        commandId: "command-flowers",
        outcome: "completed",
        sequence: 8,
        diagnostic: null,
      },
    ];
    snapshot = { ...snapshot, messages, terminals };
  }
  let closeWatch: (() => void) | undefined;
  let closed = false;
  const frames: SessionFrame[] = [];
  const publish = () => {
    frames.push({
      kind: "reset",
      reason: "history_unavailable",
      cursor: snapshot.cursor,
      baseline: snapshot,
    });
    closeWatch?.();
  };
  async function* changes(): AsyncGenerator<SessionFrame> {
    while (!closed) {
      if (frames.length === 0)
        await new Promise<void>((resolve) => {
          closeWatch = resolve;
        });
      while (frames.length > 0) {
        const frame = frames.shift();
        if (frame) yield frame;
      }
    }
  }
  function command(input: PromptCommand | CompactCommand): Promise<Accepted>;
  function command(input: CancelCommand): Promise<CancelResult>;
  function command(
    input: AbortCommand | BranchCommand | OperatorCommand | TitleCommand,
  ): Promise<undefined>;
  function command(input: ForkCommand): Promise<ForkedSession>;
  function command(
    input: SessionCommand,
  ): Promise<Accepted | CancelResult | ForkedSession | undefined>;
  function command(
    input: SessionCommand,
  ): Promise<Accepted | CancelResult | ForkedSession | undefined> {
    if (scenario !== "stable-inbox" || input.type !== "prompt")
      return previewCommand(input);
    const reply = snapshot.messages.find(
      (message) => message.value.role === "assistant",
    );
    if (reply?.value.role !== "assistant")
      throw new Error("Stable inbox fixture needs an assistant reply");
    const workId = `preview-${input.requestId}`;
    const sequence = snapshot.messages.length + 1;
    snapshot = {
      ...snapshot,
      activity: runningActivity({
        queue: { state: "running", commandId: workId },
      }),
      messages: [
        ...snapshot.messages,
        {
          id: `user-${workId}`,
          sequence,
          commandId: workId,
          value: { role: "user", content: input.text, timestamp: Date.now() },
        },
      ],
    };
    onTurn?.("running", Date.now());
    publish();
    setTimeout(() => {
      snapshot = {
        ...snapshot,
        cursor: `preview:${String(sequence + 1)}`,
        activity: idleActivity,
        messages: [
          ...snapshot.messages,
          {
            ...reply,
            id: `reply-${workId}`,
            sequence: sequence + 1,
            commandId: workId,
            value: {
              ...reply.value,
              content: [
                { type: "text", text: `Local reply ${String(sequence)}.` },
              ],
              timestamp: Date.now(),
            },
          },
        ],
      };
      onTurn?.("done", Date.now());
      publish();
    }, 650);
    return Promise.resolve({ status: "accepted", commandId: workId });
  }
  return {
    address: `grove-preview:${sessionId}`,
    command,
    extension: (id) => ({
      call: id === gardenExtensionId ? gardenCall : unsupported,
    }),
    send: unsupported,
    cancel: unsupported,
    abort: unsupported,
    modelPreference: { read: () => Promise.resolve(null), set: unsupported },
    read: () => Promise.resolve(snapshot),
    subscribe: changes,
    watch: () =>
      Promise.resolve({
        snapshot,
        changes: changes(),
        close: () => {
          closed = true;
          closeWatch?.();
          return Promise.resolve();
        },
      }),
  };
}

/** Only the existing directory/transport seam is substituted. All inbox UI is production. */
export function createGroveFixture(
  scenario: GroveScenario,
  openRequest: AppOpenRequest | null = null,
  unavailableSessionIds: readonly string[] = [],
) {
  const appContext = store({
    computerId: null,
    focus: { editing: false, surface: null },
    openRequest,
    visibility: "visible" as const,
  });
  // The owner's run status drives the shelves; row-states adds a queued row.
  const previewStatus = (agentId: string, index: number): PreviewStatus =>
    scenario === "conversation-queued"
      ? "queued"
      : scenario === "conversation-empty" ||
          scenario === "conversation-answered-inbox-lag" ||
          scenario === "conversation-failed" ||
          scenario === "conversation-interrupted" ||
          scenario === "conversation-cancelled"
        ? "idle"
        : agentId === "gardener" && index === 0
          ? "thinking"
          : scenario === "row-states" && agentId === "gardener" && index === 1
            ? "queued"
            : "idle";
  const capabilities = createCapabilityRegistry();
  if (
    scenario === "websites" ||
    scenario === "websites-held" ||
    scenario === "websites-collision"
  ) {
    let conversation: AppWebsiteConversation = {
      sessionId: "gardener-1",
      label: "A visitor needs help choosing a plan",
      lastEventAt: 1791453600000,
      needsYou: { at: 1791453600000, reason: "Please reply as a person" },
      held: scenario === "websites-held",
      heldByYou: false,
      heldByName: scenario === "websites-held" ? "Ada" : null,
      holdVersion: scenario === "websites-held" ? 1 : 0,
    };
    const select = (input: { bindingId: string; sessionId: string }) => {
      if (
        input.bindingId !== "website-consulting" ||
        input.sessionId !== conversation.sessionId
      )
        throw new Error("Website conversation not found");
    };
    capabilities.provide(channelsRead, {
      list: () =>
        Promise.resolve({
          websites: [
            {
              bindingId: "website-consulting",
              agentId: "gardener",
              origins: ["https://jamstack.consulting"],
              lifecycle: "active",
            },
          ],
        }),
      conversations: ({ bindingId }) =>
        Promise.resolve({
          conversations:
            bindingId === "website-consulting" ? [conversation] : [],
        }),
    });
    capabilities.provide(channelsPersonalManage, {
      hold: (input) => {
        select(input);
        if (input.expectedVersion !== conversation.holdVersion)
          throw new Error("Conversation changed");
        if (conversation.held && !conversation.heldByYou && !input.confirm)
          throw new Error("Confirmation required");
        conversation = {
          ...conversation,
          held: true,
          heldByYou: true,
          heldByName: "Sam",
          holdVersion: conversation.holdVersion + 1,
        };
        return Promise.resolve(conversation);
      },
      release: (input) => {
        select(input);
        if (input.expectedVersion !== conversation.holdVersion)
          throw new Error("Conversation changed");
        if (!conversation.heldByYou && !input.confirm)
          throw new Error("Not the holder");
        conversation = {
          ...conversation,
          held: false,
          heldByYou: false,
          heldByName: null,
          needsYou: null,
          holdVersion: conversation.holdVersion + 1,
        };
        return Promise.resolve(conversation);
      },
      dismiss: (input) => {
        select(input);
        if (input.expectedVersion !== conversation.holdVersion)
          throw new Error("Conversation changed");
        if (conversation.held || conversation.needsYou === null)
          throw new Error("No request to dismiss");
        conversation = {
          ...conversation,
          needsYou: null,
          holdVersion: conversation.holdVersion + 1,
        };
        return Promise.resolve(conversation);
      },
      reply: (input) => {
        select(input);
        if (!conversation.heldByYou)
          throw new Error("Use Take over to reply to this visitor");
        return Promise.resolve({ status: "sent" });
      },
    });
  }
  const connection: AppRoot = {
    capabilities,
    commands: {
      register: () =>
        Promise.resolve(() => {
          /* No host command registrations. */
        }),
    },
    context: appContext,
    identity: { appId: "grove", releaseId: "preview", surfaceId: "main" },
    lifecycle: store("connected"),
    theme: workbenchTheme(),
    ui: {
      openNavigation: unsupported,
      reportStatus: () => Promise.resolve(),
      onStatusAction: () => () => undefined,
      requestAppPermissions: () => Promise.resolve("declined" as const),
      openTeamBilling: () => Promise.resolve(),
      requestComputerChoice: () => Promise.reject(new Error("No picker")),
      requestBrowserAction: () => {
        throw new Error("Unexpected browser action");
      },
      openDesktopSettings: () => Promise.resolve(),
      reportAgentSessionSelection: () => Promise.resolve(),
      showToast: () => Promise.resolve(),
    },
    window: {
      navigation: inertHostNavigation,
      onBeforeClose: () => () => {
        /* No external window resources. */
      },
    },
    dispose: () => {
      /* All fixture state is local to its story. */
    },
  };
  const sessionOperations = [
    "agent.read",
    "agent.send",
    "agent.manage",
  ] as const;
  // Each Agent wears its own avatar: two chosen looks and one seeded default.
  const agents: AppAgent[] = [
    {
      agentId: "gardener",
      name: "Gardener",
      avatar: {
        v: 1,
        character: "cat",
        appearance: { body: "#9bd47a", stripes: "#e6f8d8" },
        expression: "normal",
        renderStyle: "plain",
      },
      sessionOperations,
    },
    {
      agentId: "librarian",
      name: "Librarian",
      avatar: {
        v: 1,
        character: "burger",
        appearance: { topBun: "#9b8cf0", bottomBun: "#ebe6ff" },
        expression: "normal",
        renderStyle: "plain",
      },
      sessionOperations,
    },
    {
      agentId: "maker",
      name: "Maker",
      avatar: seededAvatar("maker"),
      sessionOperations,
    },
  ];
  const now = Date.now();
  let directoryFailed = false;
  const rowsFor = (agentId: string): MemberInboxSession[] => {
    const rowTitles =
      scenario === "thousand"
        ? Array.from(
            { length: agentId === "gardener" ? 334 : 333 },
            (_, index) => `Conversation ${String(index + 1)}`,
          )
        : titles;
    const rows: MemberInboxSession[] = rowTitles.map((title, index) => {
      const lastActivityAt =
        now -
        (index + agents.findIndex((agent) => agent.agentId === agentId) * 2) *
          600_000;
      const base = {
        agentId,
        sessionId: `${agentId}-${String(index)}`,
        title:
          scenario === "published-game" && agentId === "gardener" && index === 1
            ? "Make me a tiny game about a frog"
            : title,
        createdAt: now - 86_400_000,
        lastActivityAt,
      };
      if (scenario === "conversation-empty")
        return { ...base, state: "done" as const };
      // The Session watch can settle before the next bulk inbox poll.
      if (
        scenario === "conversation-answered-inbox-lag" &&
        base.sessionId === "gardener-1"
      )
        return { ...base, state: "running" as const };
      const listScenario = listStates.get(scenario);
      if (listScenario !== undefined) {
        const listed = listScenario.get(base.sessionId);
        if (listed === "running" || listed === "needs_you")
          return { ...base, state: listed };
        const settled = {
          ...base,
          settledAt: lastActivityAt,
          state:
            listed === "errored" ? ("errored" as const) : ("done" as const),
        };
        // Rows outside the scenario's list were visited after they settled.
        if (listed === undefined)
          return { ...settled, visitedAt: lastActivityAt + 1 };
        return settled;
      }
      if (previewStatus(agentId, index) !== "idle")
        return { ...base, state: "running" as const };
      // Settled rows carry their owner settlement; row-states adds one failed
      // run that has not been seen yet.
      const errored =
        (scenario === "row-states" && agentId === "librarian" && index === 0) ||
        scenario === "conversation-failed" ||
        scenario === "conversation-interrupted";
      return {
        ...base,
        settledAt: lastActivityAt,
        state: errored ? ("errored" as const) : ("done" as const),
      };
    });
    if (
      (scenario === "row-states" || scenario === "many-waiting") &&
      agentId === "maker"
    )
      rows.push({ agentId, sessionId: "maker-damaged", state: "unavailable" });
    return rows;
  };
  const noAgents =
    scenario === "no-agents" ||
    scenario === "no-agent-access" ||
    scenario === "safety-notice" ||
    scenario === "seller-closed";
  const memberInbox = createFixtureMemberInbox(
    scenario === "empty" || scenario === "start-failed" || noAgents
      ? []
      : agents.flatMap((agent) => rowsFor(agent.agentId)),
    { failFirstRead: scenario === "inbox-retry" },
  );
  if (scenario === "live") {
    // The owner pushes: a settled row starts running, then fails.
    const moved = memberInbox.current("maker", "maker-5");
    if (moved !== undefined && moved.state !== "unavailable") {
      setTimeout(() => {
        memberInbox.push([
          { ...moved, state: "running", lastActivityAt: Date.now() },
        ]);
      }, 1_200);
      setTimeout(() => {
        const at = Date.now();
        memberInbox.push([
          { ...moved, state: "errored", lastActivityAt: at, settledAt: at },
        ]);
      }, 2_400);
    }
  }
  const createdAgents: AppAgent[] = [];
  capabilities.provide(agentList, {
    list: async () => {
      if (scenario === "loading")
        await new Promise((resolve) => setTimeout(resolve, 2500));
      if (scenario === "unavailable" && !directoryFailed) {
        directoryFailed = true;
        throw new Error("Agent directory unavailable");
      }
      return noAgents ? [...createdAgents] : [...agents, ...createdAgents];
    },
  });
  if (scenario !== "no-agent-access")
    capabilities.provide(agentManage, {
      open: unsupported,
      create: ({ name, avatar }) => {
        const agent = {
          agentId: `created-${String(createdAgents.length + 1)}`,
          name,
          avatar:
            avatar ??
            seededAvatar(`created-${String(createdAgents.length + 1)}`),
          sessionOperations,
        };
        createdAgents.push(agent);
        return Promise.resolve(agent);
      },
    });
  if (scenario !== "no-agent-access")
    capabilities.provide(agentAvatar, {
      setAvatar: ({ agentId, avatar }) => {
        for (const list of [agents, createdAgents]) {
          const index = list.findIndex((agent) => agent.agentId === agentId);
          if (index === -1) continue;
          const updated = { ...list[index], avatar };
          list[index] = updated;
          return Promise.resolve(updated);
        }
        return Promise.reject(new Error("No such Agent"));
      },
    });
  capabilities.provide(agentSessionWrite, {
    open: unsupported,
    openInbox: () =>
      Promise.resolve({
        fetch: (request: Request) => {
          if (
            (scenario === "safety-notice" || scenario === "seller-closed") &&
            new URL(request.url).pathname.endsWith("/inbox/notices")
          ) {
            const notice = {
              dispositionId: "app_erasure_workbench",
              appId: "app_notes",
              displayName: "Notes",
              releaseIds: ["rel_notes"],
              createdAt: 1791453600000,
            };
            const sellerClosed = {
              ...notice,
              kind: "seller-closed",
              dispositionId: JSON.stringify([
                "seller-closed",
                "team_studio",
                "team_workbench",
                "app_notes",
              ]),
              sellerAccountId: "team_studio",
              buyerAccountId: "team_workbench",
              sellerName: "Orchard studio",
              requestId: "close-studio",
            };
            return Promise.resolve(
              Response.json({
                items: [scenario === "seller-closed" ? sellerClosed : notice],
                next: null,
              }),
            );
          }
          return memberInbox.transport.fetch(request);
        },
        close: () => Promise.resolve(),
        [Symbol.dispose]: () => undefined,
      }),
  });
  let failedStart = false;
  let previewTurns = 0;
  const services: InboxServices = {
    openAgent: (_capabilities, { agentId }) => {
      if (scenario === "open-error" && agentId === "maker")
        return Promise.reject(new Error("Maker is unavailable"));
      return Promise.resolve({
        baseUrl: `https://grove-preview.invalid/${agentId}`,
        fetch: unsupported,
        close: () => Promise.resolve(),
      });
    },
    createClient: ({ baseUrl }) => {
      const agentId = new URL(baseUrl).pathname.slice(1);
      return {
        deleteSession: (sessionId) => {
          memberInbox.remove(agentId, sessionId);
          return Promise.resolve(true);
        },
        createSession: () => {
          if (scenario === "start-failed" && !failedStart) {
            failedStart = true;
            return Promise.reject(new Error("Session creation request failed"));
          }
          return Promise.resolve(`${agentId}-new`);
        },
        session: (sessionId) => {
          const index = Number(sessionId.slice(sessionId.lastIndexOf("-") + 1));
          const session = previewSession(
            sessionId,
            Number.isInteger(index) ? previewStatus(agentId, index) : "idle",
            scenario,
            (state, at) => {
              const current = memberInbox.current(agentId, sessionId);
              if (!current || current.state === "unavailable") return;
              const changed = { ...current, state, lastActivityAt: at };
              memberInbox.push([
                state === "done" ? { ...changed, settledAt: at } : changed,
              ]);
              // A different Session gains attention after the third turn.
              const foreign = memberInbox.current("maker", "maker-5");
              if (state === "done") previewTurns += 1;
              if (
                state === "done" &&
                previewTurns === 3 &&
                foreign &&
                foreign.state !== "unavailable"
              )
                memberInbox.push([
                  {
                    ...foreign,
                    state: "needs_you",
                    lastActivityAt: at,
                    settledAt: at,
                  },
                ]);
            },
          );
          // Grove seeds a conversation from its bounded read, then watches;
          // an unreadable Session fails both, as its owner would.
          const unreadable = (message: string): ShiitakeSession => ({
            ...session,
            read: () => Promise.reject(new Error(message)),
            watch: () => Promise.reject(new Error(message)),
          });
          if (scenario === "conversation-loading")
            return {
              ...session,
              read: () => new Promise(() => undefined),
              watch: () => new Promise(() => undefined),
            };
          if (scenario === "conversation-unavailable")
            return unreadable(
              "This conversation is temporarily unavailable. Try again when your Agent reconnects.",
            );
          if (unavailableSessionIds.includes(sessionId))
            return unreadable("Session baseline unavailable");
          return scenario === "baseline-error" && agentId === "maker"
            ? unreadable("Maker conversation is unavailable")
            : session;
        },
        close: () => Promise.resolve(),
      };
    },
  };
  return {
    connection: scenario === "disconnected" ? null : connection,
    services,
    updateOpenRequest: (next: AppOpenRequest | null) => {
      appContext.update({ ...appContext.get(), openRequest: next });
    },
  };
}
