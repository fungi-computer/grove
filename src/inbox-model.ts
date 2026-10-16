import type { AppAgent } from "@fungi.computer/agar/agents";
import type {
  MemberInboxItem,
  MemberInboxSession,
} from "@fungi.computer/agar/inbox";
import type { ParakeetOwnerViewState } from "@fungi.computer/parakeet/headless";
import type { SessionInboxState } from "@fungi.computer/shiitake/client";

/** One Session row of the member inbox, with the member's last visit. */
export type InboxSessionRecord = MemberInboxSession;

export type InboxSession = Extract<InboxSessionRecord, { title: string }>;

/** Status copy shared by the full Inbox and its compact Gill. */
export const inboxStatusCopy = {
  needs_you: "Waiting for you",
  running: "Working",
  errored: "Failed",
  done: "Done",
} satisfies Record<InboxSession["state"], string>;

export type InboxShelf = "active" | "settled";

/**
 * Presentation tier, ranked first to last: waiting on a person, errored and
 * unseen, running, then everything recent.
 */
export type InboxTier = "needs_you" | "errored_unseen" | "running" | "recent";

const tierRank = {
  needs_you: 0,
  errored_unseen: 1,
  running: 2,
  recent: 3,
} satisfies Record<InboxTier, number>;

export type InboxRow = InboxSession & {
  /** A run settled after the member last visited, or was never visited. */
  unseen: boolean;
  /** No run has settled yet; this Session is ready for its first message. */
  ready: boolean;
  tier: InboxTier;
  shelf: InboxShelf;
};

/** A saved Session its owner could not read; shown as its own row error. */
export type InboxUnavailableRow = Readonly<{
  agentId: string;
  sessionId: string;
}>;

export type InboxView = Readonly<{
  active: readonly InboxRow[];
  settled: readonly InboxRow[];
  unavailable: readonly InboxUnavailableRow[];
}>;

/**
 * Whether the owner still has work for the Session or waits on a person.
 * Errored and done are settled; the owner decides which.
 */
export function isInPlay(state: SessionInboxState): boolean {
  return state === "running" || state === "needs_you";
}

/**
 * Unread is settlement after the last visit. A settled Session the member has
 * never visited is unseen; conversation activity alone never is.
 */
export function isUnseen(
  settledAt: number | undefined,
  visitedAt: number | undefined,
): boolean {
  return (
    settledAt !== undefined &&
    (visitedAt === undefined || settledAt > visitedAt)
  );
}

function tierOf(state: SessionInboxState, unseen: boolean): InboxTier {
  switch (state) {
    case "needs_you":
      return "needs_you";
    case "running":
      return "running";
    case "errored":
      return unseen ? "errored_unseen" : "recent";
    case "done":
      return "recent";
  }
}

/** Rank by settlement, falling back to creation, with stable identity ties. */
function compareInboxRows(a: InboxRow, b: InboxRow): number {
  return (
    tierRank[a.tier] - tierRank[b.tier] ||
    (b.settledAt ?? b.createdAt) - (a.settledAt ?? a.createdAt) ||
    a.agentId.localeCompare(b.agentId) ||
    a.sessionId.localeCompare(b.sessionId)
  );
}

/** A row's held placement is separate from its live status and unread bead. */
export type InboxPlacement = Readonly<{
  key: string;
  shelf: "Needs you" | "Working" | "Ready" | "Finished";
  attention: string | null;
}>;

const inboxShelves = ["Needs you", "Working", "Ready", "Finished"] as const;

function inboxListShelf(row: InboxRow): InboxPlacement["shelf"] {
  if (row.tier === "running") return "Working";
  if (row.shelf === "active") return "Needs you";
  return row.ready ? "Ready" : "Finished";
}

function placement(row: InboxRow): InboxPlacement {
  return {
    key: sessionKey(row.agentId, row.sessionId),
    shelf: inboxListShelf(row),
    attention:
      row.tier === "needs_you" || row.tier === "errored_unseen"
        ? `${row.tier}:${String(row.settledAt ?? row.createdAt)}`
        : null,
  };
}

/**
 * Preserve scan order between explicit reorder points. Only a new row or a
 * foreign Session gaining attention lifts; the open Session reserves its slot.
 * Hands-on holds retain the last attention facts so deferred moves are not lost.
 */
export function orderInbox(
  previous: readonly InboxPlacement[] | null,
  rows: readonly InboxRow[],
  context: Readonly<{
    openKey: string | null;
    reorder: boolean;
    held: boolean;
  }>,
): readonly InboxPlacement[] {
  const live = new Map(
    rows.map((row) => [sessionKey(row.agentId, row.sessionId), row]),
  );
  if (previous !== null && context.held) return previous;
  const ranked = [...rows].sort(
    (a, b) =>
      (b.settledAt ?? b.createdAt) - (a.settledAt ?? a.createdAt) ||
      a.agentId.localeCompare(b.agentId) ||
      a.sessionId.localeCompare(b.sessionId),
  );
  const prior = new Map(previous?.map((entry) => [entry.key, entry]));
  const lifted = ranked.map(placement).filter((entry) => {
    const old = prior.get(entry.key);
    return (
      old === undefined ||
      (entry.key !== context.openKey &&
        entry.attention !== null &&
        entry.attention !== old.attention)
    );
  });
  const liftedKeys = new Set(lifted.map((entry) => entry.key));
  const pinned = prior.get(context.openKey ?? "");
  const pinIndex =
    pinned === undefined
      ? -1
      : (previous ?? [])
          .filter((entry) => entry.shelf === pinned.shelf)
          .findIndex((entry) => entry.key === pinned.key);
  const next = inboxShelves.flatMap((shelf) => {
    let entries: InboxPlacement[];
    if (previous === null || context.reorder) {
      entries = ranked.map(placement).filter((entry) => entry.shelf === shelf);
    } else {
      entries = [
        ...lifted.filter((entry) => entry.shelf === shelf),
        ...previous
          .filter(
            (entry) => entry.shelf === shelf && !liftedKeys.has(entry.key),
          )
          .flatMap((entry) => {
            const row = live.get(entry.key);
            return row === undefined
              ? []
              : [{ ...entry, attention: placement(row).attention }];
          }),
      ];
    }
    const pinnedRow = pinned === undefined ? undefined : live.get(pinned.key);
    if (pinned !== undefined && pinnedRow !== undefined) {
      entries = entries.filter((entry) => entry.key !== pinned.key);
      if (pinned.shelf === shelf)
        entries.splice(Math.min(pinIndex, entries.length), 0, {
          ...pinned,
          attention: placement(pinnedRow).attention,
        });
    }
    return entries;
  });
  return previous !== null &&
    next.length === previous.length &&
    next.every(
      (entry, i) =>
        entry.key === previous[i]?.key &&
        entry.shelf === previous[i]?.shelf &&
        entry.attention === previous[i]?.attention,
    )
    ? previous
    : next;
}

/** Live presentation borrowed from the currently open conversation. */
export type InboxOpenSessionState = Readonly<{
  agentId: string;
  sessionId: string;
  state: ParakeetOwnerViewState;
}>;

function inboxState(view: ParakeetOwnerViewState): SessionInboxState {
  switch (view.kind) {
    case "idle":
      return "done";
    case "waiting_for_you":
      return "needs_you";
    case "error":
      return "errored";
    default:
      return "running";
  }
}

/**
 * Rank owner rows and mark unseen settlements. The open Session borrows the
 * same live readout as its footer while the bulk feed catches up.
 */
export function buildInboxView(
  agents: readonly AppAgent[],
  sessions: readonly MemberInboxItem[],
  selectedAgentId: string | null = null,
  openSession?: InboxOpenSessionState,
): InboxView {
  const knownAgents = new Set(agents.map((agent) => agent.agentId));
  const visible = sessions.filter(
    (session) =>
      !("kind" in session) &&
      knownAgents.has(session.agentId) &&
      (selectedAgentId === null || session.agentId === selectedAgentId),
  );
  return buildInboxSessionView(visible, openSession);
}

/** Apply the same Inbox policy to a page already filtered by its host owner. */
export function buildInboxSessionView(
  sessions: readonly MemberInboxItem[],
  openSession?: InboxOpenSessionState,
): InboxView {
  const rows: InboxRow[] = [];
  const unavailable: InboxUnavailableRow[] = [];
  for (const session of sessions) {
    if ("kind" in session) continue;
    if (session.state === "unavailable") {
      unavailable.push({
        agentId: session.agentId,
        sessionId: session.sessionId,
      });
      continue;
    }
    const unseen = isUnseen(session.settledAt, session.visitedAt);
    // The open conversation and its row share Parakeet's live state. The bulk
    // owner feed still supplies timestamps and visit acknowledgements.
    const live =
      openSession?.agentId === session.agentId &&
      openSession.sessionId === session.sessionId
        ? openSession.state
        : undefined;
    const state = live ? inboxState(live) : session.state;
    const ready = live
      ? live.kind === "idle"
      : state === "done" && session.settledAt === undefined;
    const tier = tierOf(state, unseen);
    rows.push({
      ...session,
      state,
      ready,
      unseen,
      tier,
      shelf: tier === "recent" ? "settled" : "active",
    });
  }
  rows.sort(compareInboxRows);
  return {
    active: rows.filter((row) => row.shelf === "active"),
    settled: rows.filter((row) => row.shelf === "settled"),
    unavailable: unavailable.sort(
      (a, b) =>
        a.agentId.localeCompare(b.agentId) ||
        a.sessionId.localeCompare(b.sessionId),
    ),
  };
}

export function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}\u0000${sessionId}`;
}

export function agentLabel(agent: AppAgent): string {
  return agent.name;
}
