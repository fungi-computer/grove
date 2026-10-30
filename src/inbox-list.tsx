import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { measureElement, useVirtualizer } from "@tanstack/react-virtual";
import type { AppAgent } from "@fungi.computer/agar/agents";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Trash2 } from "lucide-react";
import { ActionRow } from "@fungi.computer/caps/components/action-row";
import { DataListHeading } from "@fungi.computer/caps/components/data-list";
import { Status } from "@fungi.computer/caps/components/status";
import { Sigil } from "@fungi.computer/sigils";
import type { WebsiteInboxRow } from "./website-inbox.js";
import {
  agentLabel,
  inboxStatusCopy,
  isInPlay,
  orderInbox,
  sessionKey,
  type InboxRow,
  type InboxUnavailableRow,
  type InboxView,
  type InboxPlacement,
} from "./inbox-model.js";
import type { PendingSelection } from "@fungi.computer/parakeet/conversation-opening";

type Row =
  | { kind: "heading"; key: string; title: string; gap: boolean }
  | {
      kind: "session";
      key: string;
      shelf: string;
      session: InboxView["settled"][number];
    }
  | { kind: "unavailable"; key: string; session: InboxUnavailableRow }
  | { kind: "website"; key: string; website: WebsiteInboxRow }
  | { kind: "hint"; key: string; loading: boolean };

function flatten(
  view: InboxView,
  placements: readonly InboxPlacement[],
  websites: readonly WebsiteInboxRow[],
  loading: boolean,
  failed: boolean,
): Row[] {
  const rows: Row[] = [];
  if (loading) rows.push({ kind: "hint", key: "loading", loading: true });
  let groups = 0;
  const live = [...view.active, ...view.settled];
  const byKey = new Map(
    live.map((row) => [sessionKey(row.agentId, row.sessionId), row]),
  );
  for (const title of ["Needs you", "Working", "Ready", "Finished"] as const) {
    const sessions = placements
      .filter((entry) => entry.shelf === title)
      .flatMap((entry) => {
        const row = byKey.get(entry.key);
        return row === undefined ? [] : [row];
      });
    if (sessions.length === 0) continue;
    rows.push({
      kind: "heading",
      key: title,
      title,
      gap: groups++ > 0,
    });
    for (const session of sessions)
      rows.push({
        kind: "session",
        key: sessionKey(session.agentId, session.sessionId),
        shelf: title,
        session,
      });
  }
  if (view.unavailable.length > 0) {
    rows.push({
      kind: "heading",
      key: "Unavailable",
      title: "Unavailable",
      gap: groups > 0,
    });
    for (const session of view.unavailable)
      rows.push({
        kind: "unavailable",
        key: sessionKey(session.agentId, session.sessionId),
        session,
      });
  }
  if (websites.length > 0) {
    rows.push({
      kind: "heading",
      key: "Websites",
      title: "Websites",
      gap: rows.length > 0,
    });
    for (const website of websites)
      rows.push({
        kind: "website",
        key: `website:${website.bindingId}:${website.conversation.sessionId}`,
        website,
      });
  }
  if (rows.length === 0 && !failed)
    rows.push({ kind: "hint", key: "empty", loading: false });
  return rows;
}

export function InboxList({
  viewport,
  view,
  agents,
  loading,
  failed,
  pendingSelection,
  selectedAgentId,
  selectedSessionId,
  onSelect,
  onDelete,
  deleting,
  websites,
  selectedWebsite,
  onSelectWebsite,
}: {
  viewport: RefObject<HTMLDivElement>;
  view: InboxView;
  agents: ReadonlyMap<string, AppAgent>;
  loading: boolean;
  failed: boolean;
  pendingSelection: PendingSelection | null;
  selectedAgentId: string | null;
  selectedSessionId: string | null;
  onSelect: (agentId: string, sessionId: string) => void;
  onDelete?: (agentId: string, sessionId: string) => void;
  deleting?: PendingSelection | null;
  websites: readonly WebsiteInboxRow[];
  selectedWebsite: WebsiteInboxRow | undefined;
  onSelectWebsite: (row: WebsiteInboxRow) => void;
}) {
  const openKey =
    selectedAgentId !== null && selectedSessionId !== null
      ? sessionKey(selectedAgentId, selectedSessionId)
      : null;
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const held = pointerInside || focusInside;
  const [reopened, setReopened] = useState(0);
  const [previous, setPrevious] = useState<{
    placements: readonly InboxPlacement[] | null;
    openKey: string | null;
    reopened: number;
  }>({ placements: null, openKey, reopened });
  const placements = useMemo(
    () =>
      orderInbox(previous.placements, [...view.active, ...view.settled], {
        // A newly opened row takes its shelf from the Session baseline. Its
        // slot stays pinned only after that opening reorder has completed.
        openKey: previous.openKey === openKey ? openKey : null,
        held,
        reorder: previous.openKey !== openKey || previous.reopened !== reopened,
      }),
    [previous, view, openKey, held, reopened],
  );
  useEffect(() => {
    if (
      !held &&
      (previous.placements !== placements ||
        previous.openKey !== openKey ||
        previous.reopened !== reopened)
    )
      setPrevious({ placements, openKey, reopened });
  }, [held, previous, placements, openKey, reopened]);
  useEffect(() => {
    const element = viewport.current;
    if (element === null) return;
    let visible = element.clientWidth > 0 && element.clientHeight > 0;
    const observer =
      "ResizeObserver" in globalThis
        ? new ResizeObserver(([entry]) => {
            const next =
              entry.contentRect.width > 0 && entry.contentRect.height > 0;
            if (next && !visible) setReopened((value) => value + 1);
            visible = next;
          })
        : undefined;
    observer?.observe(element);
    const onVisible = () => {
      if (document.visibilityState === "visible")
        setReopened((value) => value + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [viewport]);
  const rows = useMemo(
    () => flatten(view, placements, websites, loading, failed),
    [view, placements, websites, loading, failed],
  );
  const getItemKey = useCallback(
    (index: number) => rows[index]?.key ?? index,
    [rows],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    getItemKey,
    estimateSize: (index) => (rows[index]?.kind === "heading" ? 24 : 44),
    // A collapsed rail or phone sheet has no layout. Keep its measured rows
    // instead of caching zero heights for rows that cannot be remeasured.
    measureElement: (element, entry, instance) => {
      const size = measureElement(element, entry, instance);
      if (size > 0) return size;
      return (
        measureElement(element, undefined, instance) ||
        instance.options.estimateSize(instance.indexFromElement(element))
      );
    },
    initialRect: { width: 320, height: 800 },
    overscan: 5,
    useFlushSync: false,
  });
  // Shelf changes place rows directly. A cross-shelf FLIP passes row text
  // through its neighbours and headings, even when the logical slots are unique.
  return (
    <div
      className="inbox-list px-1 py-1"
      onPointerEnter={() => {
        setPointerInside(true);
      }}
      onPointerLeave={() => {
        setPointerInside(false);
      }}
      onFocusCapture={() => {
        setFocusInside(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocusInside(false);
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          const session =
            row.kind === "session" || row.kind === "unavailable"
              ? row.session
              : null;
          const agent = session ? agents.get(session.agentId) : undefined;
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              data-inbox-shelf={
                row.kind === "session"
                  ? row.shelf
                  : row.kind === "unavailable"
                    ? "Unavailable"
                    : undefined
              }
              className={row.kind === "heading" ? "inbox-shelf" : undefined}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${String(item.start)}px)`,
                paddingTop: row.kind === "heading" && row.gap ? 4 : 0,
              }}
            >
              {row.kind === "heading" ? (
                <DataListHeading style={{ paddingBottom: 0 }}>
                  {row.title}
                </DataListHeading>
              ) : row.kind === "hint" ? (
                <p
                  className={
                    row.loading
                      ? "inbox-empty m-0 px-2 py-3 text-sm text-(--stipe-fg-muted)"
                      : "m-0 px-2 py-3 text-xs text-(--stipe-fg-muted)"
                  }
                  role={row.loading ? "status" : undefined}
                >
                  {row.loading
                    ? "Loading conversations…"
                    : "No conversations yet."}
                </p>
              ) : row.kind === "website" ? (
                <ActionRow
                  appearance="plain"
                  density="compact"
                  className={`inbox-row${selectedWebsite?.bindingId === row.website.bindingId && selectedWebsite.conversation.sessionId === row.website.conversation.sessionId ? " is-selected bg-base-300" : ""}`}
                  data-testid="inbox-website-row"
                  label={row.website.conversation.label || "Website visitor"}
                  description={
                    <span className="inline-flex items-center gap-1">
                      <Sigil name="internet" size={14} />
                      {row.website.siteLabel}
                    </span>
                  }
                  trailing={
                    row.website.conversation.held ? (
                      <span className="text-xs">
                        {row.website.conversation.heldByYou
                          ? "You're replying"
                          : "With a teammate"}
                      </span>
                    ) : row.website.conversation.needsYou ? (
                      <Status
                        size="compact"
                        tone="accent"
                        title={row.website.conversation.needsYou.reason}
                      />
                    ) : null
                  }
                  onClick={() => {
                    onSelectWebsite(row.website);
                  }}
                  variant="ghost"
                />
              ) : row.kind === "unavailable" ? (
                agent ? (
                  <UnavailableSessionRow agent={agent} row={row.session} />
                ) : null
              ) : agent ? (
                <SessionRow
                  agent={agent}
                  session={row.session}
                  attention={row.session.unseen}
                  pending={
                    pendingSelection?.agentId === row.session.agentId &&
                    pendingSelection.sessionId === row.session.sessionId
                  }
                  selected={
                    selectedAgentId === row.session.agentId &&
                    selectedSessionId === row.session.sessionId
                  }
                  onDelete={
                    onDelete && agent.sessionOperations.includes("agent.manage")
                      ? () => {
                          onDelete(row.session.agentId, row.session.sessionId);
                        }
                      : undefined
                  }
                  deleting={
                    deleting?.agentId === row.session.agentId &&
                    deleting.sessionId === row.session.sessionId
                  }
                  onSelect={() => {
                    onSelect(row.session.agentId, row.session.sessionId);
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionRow({
  agent,
  session,
  attention,
  pending,
  selected,
  onSelect,
  onDelete,
  deleting,
}: {
  agent: AppAgent;
  session: InboxRow;
  attention: boolean;
  pending: boolean;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  deleting: boolean;
}): React.JSX.Element {
  const inPlay = isInPlay(session.state);
  const errored = session.state === "errored";
  // Live state is a quiet bead; the label lives in the row's accessible name.
  const activity = (
    <span className="inbox-row-activity inline-grid shrink-0 grid-cols-[1rem_7ch] items-center gap-1.5 text-[0.6875rem]">
      <span className="inbox-row-status flex items-center justify-center">
        {pending || inPlay || errored ? (
          <span className="sr-only">
            {pending ? "Opening" : inboxStatusCopy[session.state]}
          </span>
        ) : null}
        {pending || inPlay ? (
          <Status
            size="compact"
            title={pending ? "Opening" : inboxStatusCopy[session.state]}
            motion={session.state === "running" || pending ? "pulse" : "none"}
            tone={
              pending
                ? "neutral"
                : session.state === "needs_you"
                  ? "accent"
                  : "info"
            }
          />
        ) : errored ? (
          <Status size="compact" title={inboxStatusCopy.errored} tone="error" />
        ) : attention ? (
          <Status
            size="compact"
            title="Finished since your last visit"
            tone="neutral"
          />
        ) : null}
      </span>
      <time
        className="inbox-row-age min-w-0 truncate text-right tabular-nums text-(--stipe-fg-muted)"
        dateTime={new Date(session.lastActivityAt).toISOString()}
      >
        {formatAge(session.lastActivityAt)}
      </time>
    </span>
  );
  return (
    <div className="relative group">
      <ActionRow
        aria-current={selected ? "page" : undefined}
        aria-label={`${session.title || "Untitled session"} — ${agentLabel(agent)}${attention ? " — Finished since your last visit" : ""}${session.ready ? " — Ready" : inPlay || errored ? ` — ${inboxStatusCopy[session.state]}` : ""}`}
        aria-busy={pending || undefined}
        appearance="plain"
        className={`inbox-row pr-9${selected ? " is-selected bg-base-300" : ""}`}
        data-attention={attention ? "true" : "false"}
        data-pending={pending ? "true" : "false"}
        data-session-id={session.sessionId}
        data-status={session.state}
        data-testid="inbox-session-row"
        density="compact"
        description={agentLabel(agent)}
        label={session.title || "Untitled session"}
        onClick={onSelect}
        trailing={activity}
        variant="ghost"
      />
      {onDelete ? (
        <IconButton
          aria-label={`Delete conversation ${session.title || "Untitled session"}`}
          title="Delete conversation"
          icon={<Trash2 />}
          iconSize="sm"
          size="sm"
          className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-[899px]:opacity-100"
          disabled={inPlay || deleting}
          onClick={onDelete}
        />
      ) : null}
    </div>
  );
}

function UnavailableSessionRow({
  agent,
  row,
}: {
  agent: AppAgent;
  row: InboxUnavailableRow;
}): React.JSX.Element {
  return (
    <div
      className="inbox-row is-unavailable flex min-h-11 w-full items-center gap-2 rounded-field border-(length:--border) border-transparent px-2 py-1 pr-9 text-left text-base-content"
      data-session-id={row.sessionId}
      data-testid="inbox-unavailable-row"
      role="group"
    >
      <span className="inbox-row-copy flex min-w-0 flex-1 flex-col">
        <strong className="truncate text-sm font-medium">
          Conversation unavailable
        </strong>
        <small className="truncate text-xs text-(--stipe-fg-muted)">
          {agentLabel(agent)} <span aria-hidden="true">·</span> This saved
          conversation could not be read.
        </small>
      </span>
      <span className="inbox-row-activity inline-grid shrink-0 grid-cols-[1rem_7ch] items-center gap-1.5 text-[0.6875rem]">
        <span className="inbox-row-status flex items-center justify-center">
          <Status
            size="compact"
            tone="error"
            title="This saved conversation could not be read"
          />
        </span>
      </span>
    </div>
  );
}

function formatAge(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${String(Math.floor(delta / 60_000))}m`;
  if (delta < 86_400_000) return `${String(Math.floor(delta / 3_600_000))}h`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
