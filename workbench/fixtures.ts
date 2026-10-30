import { seededAvatar } from "@fungi.computer/sprite/avatar";
import {
  inertHostNavigation,
  createCapabilityRegistry,
  type AppOpenRequest,
  type AppRoot,
  type ReadonlyStore,
} from "@fungi.computer/agar";
import { appsOpen } from "@fungi.computer/agar/apps";
import type { GameSharePreview } from "../src/game-share-card.js";
import { printsPanelPng } from "./prints-panel-image.js";
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
          state: "needs_you",
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
      expanded: true,
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
  | "command-retry"
  | "queued-recall"
  | "queued-cancel"
  | "timeline"
  | "prints-panel"
  | "websites"
  | "websites-held"
  | "websites-collision"
  | "inbox"
  | "long-model"
  | "safety-notice"
  | "seller-closed"
  | "thousand"
  | "start-failed"
  | "start-failed-open"
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
  | "failed-turn-retry"
  | "admission-retry"
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

type AdmissionCommand = PromptCommand | CompactCommand;
type UnrecordedCommand =
  AbortCommand | BranchCommand | OperatorCommand | TitleCommand;
type PreviewResult = Accepted | CancelResult | ForkedSession | undefined;

/**
 * The preview has no owner: it takes no commands, and its waiting work has
 * always "already started", so a cancel gets the owner's typed too-late answer.
 */
function previewCommand(input: AdmissionCommand): Promise<Accepted>;
function previewCommand(input: CancelCommand): Promise<CancelResult>;
function previewCommand(input: UnrecordedCommand): Promise<undefined>;
function previewCommand(input: ForkCommand): Promise<ForkedSession>;
function previewCommand(input: SessionCommand): Promise<PreviewResult>;
function previewCommand(input: SessionCommand): Promise<PreviewResult> {
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
  const admittedRequests = new Map<string, string>();
  const withdrawnRequests = new Set<string>();
  let gardenCalls = 0;
  const index = Number(sessionId.slice(sessionId.lastIndexOf("-") + 1));
  const publishedGame =
    scenario === "published-game" && sessionId === "gardener-1";
  // The ordinary reply preview carries a real catalog identity and nonzero
  // usage; opaque "auto" placeholders cannot prove the composer's readouts.
  const catalogReply = scenario === "inbox" && sessionId === "gardener-1";
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
    toolOutput: [],
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
                      provider: catalogReply
                        ? "cloudflare-workers-ai"
                        : scenario === "conversation-answered-inbox-lag" ||
                            scenario === "long-model"
                          ? "openai"
                          : "camel",
                      model: catalogReply
                        ? "@cf/moonshotai/kimi-k2.6"
                        : scenario === "long-model"
                          ? "gpt-6-luna-long-context-preview-2026-10-28"
                          : scenario === "conversation-answered-inbox-lag"
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
                        input: catalogReply ? 500 : 1,
                        output: catalogReply ? 186 : 1,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: catalogReply ? 686 : 2,
                        cost: {
                          input: catalogReply ? 0.00008 : 0,
                          output: catalogReply ? 0.0001 : 0,
                          cacheRead: 0,
                          cacheWrite: 0,
                          total: catalogReply ? 0.00018 : 0,
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
    const settledReply = snapshot.messages.find(
      (message) => message.value.role === "assistant",
    )?.value;
    if (settledReply?.role !== "assistant")
      throw new Error("Timeline fixture needs a settled reply");
    // A current model, not the retired camel/auto the base reply carries.
    const reply = {
      ...settledReply,
      provider: "openai",
      model: "openai/gpt-6-luna",
    };
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
      {
        // Another Agent's message, as the host stamps a delegated reply.
        ...user(
          "soil-report",
          6,
          "Soil test finished: pH 6.8, heavy clay, low in potassium. Add grit and a potash feed before planting.",
        ),
        meta: {
          author: { id: "agent_soil", name: "Soil analyst", kind: "agent" },
        },
      },
      user(
        "flowers",
        7,
        "Nice. Can you add something that flowers in late summer?",
      ),
      assistant(
        "summer",
        8,
        "Add **Japanese anemones** to the south bed: they flower from August to October and are happy in part shade.\n\nToad lilies would suit the north bed too.",
        "Choose late flowers that tolerate shade.",
      ),
    ];
    const terminals: SessionSnapshot["terminals"] = [
      {
        commandId: "command-flowers",
        outcome: "completed",
        sequence: 9,
        diagnostic: null,
      },
    ];
    snapshot = { ...snapshot, messages, terminals };
  }
  if (scenario === "prints-panel" && sessionId === "gardener-1") {
    const settledReply = snapshot.messages.find(
      (message) => message.value.role === "assistant",
    )?.value;
    if (settledReply?.role !== "assistant")
      throw new Error("Prints panel fixture needs a settled reply");
    const reply = {
      ...settledReply,
      provider: "openai",
      model: "openai/gpt-6-luna",
    };
    const panel = {
      printId: "print_bus_stop_1",
      destination: {
        computerId: "computer-a",
        path: "/prints/mira-bus-stop-in-the-rain.png",
      },
      format: "png",
      width: 1536,
      height: 1024,
      bytes: 4945,
      costMilliunits: 210,
      model: "gpt-image-2",
    };
    const messages: SessionSnapshot["messages"] = [
      {
        id: "panel-ask",
        sequence: 1,
        commandId: "command-panel-ask",
        value: {
          role: "user",
          content: "@Mira at the bus stop in the rain, storybook style",
          timestamp: Date.now(),
        },
      },
      {
        id: "panel-call",
        sequence: 2,
        commandId: null,
        value: {
          ...reply,
          content: [
            {
              type: "toolCall",
              id: "panel-execute",
              name: "execute",
              arguments: {
                code: "return await env.PRINTS.generateImage({ prompt: 'Mira at the bus stop in the rain', characters: ['Mira'], style: 'storybook' })",
              },
            },
          ],
        },
      },
      {
        id: "panel-result",
        sequence: 3,
        commandId: null,
        value: {
          role: "toolResult",
          toolCallId: "panel-execute",
          toolName: "execute",
          content: [
            { type: "text", text: JSON.stringify(panel) },
            { type: "image", data: printsPanelPng, mimeType: "image/png" },
          ],
          isError: false,
          timestamp: Date.now(),
        },
      },
      {
        id: "panel-reply",
        sequence: 4,
        commandId: null,
        value: {
          ...reply,
          content: [
            {
              type: "text",
              text: "Here is the panel: Mira waiting at the bus stop in the rain, in your storybook style. It is saved in Prints as print_bus_stop_1 and cost 0.21 credits.",
            },
          ],
        },
      },
    ];
    snapshot = {
      ...snapshot,
      messages,
      terminals: [
        {
          commandId: "command-panel-ask",
          outcome: "completed",
          sequence: 5,
          diagnostic: null,
        },
      ],
    };
  }
  if (scenario === "failed-turn-retry") {
    admittedRequests.set("failed-request", commandId);
    snapshot = {
      ...snapshot,
      activity: idleActivity,
      progress: null,
      messages: [
        {
          id: "failed-user",
          requestId: "failed-request",
          commandId,
          sequence: 1,
          value: {
            role: "user",
            content: [
              { type: "text", text: "Retry this attached frame." },
              {
                type: "image",
                mimeType: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6KQAAAABJRU5ErkJggg==",
              },
            ],
            timestamp: Date.now(),
          },
        },
      ],
      terminals: [
        {
          commandId,
          outcome: "failed",
          sequence: 2,
          diagnostic: "The worker stopped. Retry keeps the original input.",
        },
      ],
    };
  }
  if (scenario === "admission-retry") {
    snapshot = {
      ...snapshot,
      activity: queuedActivity("newer-image-command"),
      progress: null,
      messages: [],
      terminals: [],
      pending: {
        total: 1,
        hasMore: false,
        prompts: [
          {
            commandId: "newer-image-command",
            requestId: "newer-image-request",
            text: "Compare this frame.",
            delivery: "followUp",
            images: [
              {
                type: "image",
                mimeType: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6KQAAAABJRU5ErkJggg==",
              },
            ],
          },
        ],
      },
    };
  }
  if (scenario === "queued-recall" || scenario === "queued-cancel") {
    admittedRequests.set("request-A", "recall-A");
    admittedRequests.set("request-B", "recall-B");
    snapshot = {
      ...snapshot,
      activity: queuedActivity("recall-A"),
      progress: null,
      pending: {
        total: 2,
        hasMore: false,
        prompts: [
          {
            commandId: "recall-A",
            requestId: "request-A",
            text:
              scenario === "queued-cancel"
                ? "Cancel this queued task."
                : "A stays queued",
            delivery: "followUp",
          },
          {
            commandId: "recall-B",
            requestId: "request-B",
            text:
              scenario === "queued-cancel"
                ? "Keep this queued task."
                : "B recall target",
            delivery: "followUp",
            images: [
              {
                type: "image",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6KQAAAABJRU5ErkJggg==",
                mimeType: "image/png",
              },
            ],
          },
        ],
      },
    };
    if (scenario === "queued-cancel")
      snapshot = {
        ...snapshot,
        activity: runningActivity(),
        progress: {
          messageId: "queued-cancel-progress",
          revision: 1,
          text: "The current turn keeps running.",
          thinking: "",
          textOffset: 0,
          thinkingOffset: 0,
          textTruncated: false,
          thinkingTruncated: false,
        },
      };
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
  let refuseAdmission: ((reason: Error) => void) | undefined;
  let heldAdmission = false;
  const modelsQueue = new Set([
    "queued-recall",
    "failed-turn-retry",
    "admission-retry",
  ]).has(scenario);

  function cancelDelayed(input: CancelCommand): Promise<CancelResult> {
    if (!input.onlyIfPending)
      return Promise.reject(
        new Error("Queued cancellation must be pending-only"),
      );
    return new Promise((resolve) => {
      setTimeout(() => {
        if (
          !snapshot.pending.prompts.some(
            (prompt) => prompt.commandId === input.commandId,
          )
        ) {
          resolve({ status: "too_late", commandId: input.commandId });
          return;
        }
        const prompts = snapshot.pending.prompts.filter(
          (prompt) => prompt.commandId !== input.commandId,
        );
        snapshot = {
          ...snapshot,
          pending: { total: prompts.length, hasMore: false, prompts },
        };
        publish();
        resolve({ status: "accepted", commandId: input.commandId });
      }, 2500);
    });
  }

  function recallQueued(input: CancelCommand): Promise<CancelResult> {
    if (
      !snapshot.pending.prompts.some(
        (prompt) => prompt.commandId === input.commandId,
      )
    )
      return Promise.resolve({
        status: "too_late",
        commandId: input.commandId,
      });
    const prompts = snapshot.pending.prompts.filter(
      (prompt) => prompt.commandId !== input.commandId,
    );
    snapshot = {
      ...snapshot,
      activity:
        prompts.length === 0
          ? idleActivity
          : queuedActivity(prompts[0].commandId),
      pending: { total: prompts.length, hasMore: false, prompts },
    };
    publish();
    if (scenario === "admission-retry") {
      // Refuse the held local request after Recall has restored its newer
      // queued payload. The next event turn follows Recall's microtasks.
      setTimeout(() => {
        refuseAdmission?.(new Error("Prompt admission refused"));
        refuseAdmission = undefined;
      }, 0);
    }
    return Promise.resolve({
      status: "accepted",
      commandId: input.commandId,
    });
  }

  function admitQueued(input: PromptCommand): Promise<Accepted> {
    if (scenario === "admission-retry" && !heldAdmission) {
      heldAdmission = true;
      return new Promise((_resolve, reject) => {
        refuseAdmission = reject;
      });
    }
    if (withdrawnRequests.has(input.requestId))
      return Promise.reject(new Error("Request was withdrawn"));
    const prior = admittedRequests.get(input.requestId);
    if (prior !== undefined)
      return Promise.resolve({ status: "accepted", commandId: prior });
    const commandId = `preview-${input.requestId}`;
    admittedRequests.set(input.requestId, commandId);
    const prompt = {
      commandId,
      requestId: input.requestId,
      text: input.text,
      delivery: input.delivery,
    };
    const prompts = [
      ...snapshot.pending.prompts,
      input.images === undefined ? prompt : { ...prompt, images: input.images },
    ];
    snapshot = {
      ...snapshot,
      activity:
        scenario === "failed-turn-retry" || scenario === "admission-retry"
          ? queuedActivity(commandId)
          : snapshot.activity,
      pending: { total: prompts.length, hasMore: false, prompts },
    };
    publish();
    return Promise.resolve({ status: "accepted", commandId });
  }

  function replyInInbox(input: PromptCommand): Promise<Accepted> {
    if (withdrawnRequests.has(input.requestId))
      return Promise.reject(new Error("Request was withdrawn"));
    const reply = snapshot.messages.find(
      (message) => message.value.role === "assistant",
    );
    if (reply?.value.role !== "assistant")
      throw new Error("Stable inbox fixture needs an assistant reply");
    const workId = `preview-${input.requestId}`;
    admittedRequests.set(input.requestId, workId);
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
          requestId: input.requestId,
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

  function command(input: AdmissionCommand): Promise<Accepted>;
  function command(input: CancelCommand): Promise<CancelResult>;
  function command(input: UnrecordedCommand): Promise<undefined>;
  function command(input: ForkCommand): Promise<ForkedSession>;
  function command(input: SessionCommand): Promise<PreviewResult>;
  function command(input: SessionCommand): Promise<PreviewResult> {
    if (input.type === "cancel") {
      if (scenario === "queued-cancel") return cancelDelayed(input);
      if (modelsQueue) return recallQueued(input);
    }
    if (input.type === "prompt") {
      if (modelsQueue) return admitQueued(input);
      if (scenario === "stable-inbox") return replyInInbox(input);
    }
    return previewCommand(input);
  }
  return {
    address: `grove-preview:${sessionId}`,
    readSettlement: unsupported,
    latestPending: () =>
      Promise.resolve(snapshot.pending.prompts.at(-1) ?? null),
    command,
    withdraw: (requestId) => {
      const commandId = admittedRequests.get(requestId);
      if (commandId !== undefined)
        return Promise.resolve({ status: "accepted", commandId });
      withdrawnRequests.add(requestId);
      return Promise.resolve({ status: "unknown" });
    },
    extension: (id) => ({
      call:
        id === gardenExtensionId
          ? async (command, input) => {
              const attempt = ++gardenCalls;
              if (scenario === "command-retry" && attempt >= 2) {
                // Both attempts stay in flight long enough to inspect the
                // ordinary running row, not just the failure or final result.
                await new Promise<void>((resolve) => {
                  setTimeout(resolve, 1250);
                });
                if (attempt === 2)
                  throw new Error("The watering service is unavailable.");
              }
              return gardenCall(command, input);
            }
          : unsupported,
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
          scenario === "failed-turn-retry" ||
          scenario === "conversation-interrupted" ||
          scenario === "conversation-cancelled"
        ? "idle"
        : agentId === "gardener" && index === 0
          ? "thinking"
          : scenario === "row-states" && agentId === "gardener" && index === 1
            ? "queued"
            : "idle";
  const capabilities = createCapabilityRegistry();
  if (scenario === "prints-panel")
    // The workbench has no media-role App; Open in Prints just resolves.
    capabilities.provide(appsOpen, {
      open: () => Promise.resolve(),
      role: () => Promise.resolve({ displayName: "Prints" }),
    });
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
        scenario === "failed-turn-retry" ||
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
          if (
            (scenario === "start-failed" || scenario === "start-failed-open") &&
            !failedStart
          ) {
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
