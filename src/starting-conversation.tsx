import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { correlationKey } from "@fungi.computer/cairn";
import type { AppAgent } from "@fungi.computer/agar/agents";
import { Composer } from "@fungi.computer/caps/blocks/composer";
import { Card } from "@fungi.computer/caps/components/card";
import { SendAction } from "@fungi.computer/caps/components/send-action";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import {
  openingTarget,
  shownConversation,
  type ConversationTarget,
  type ViewState,
} from "@fungi.computer/parakeet/conversation-view";
import { HeadLoading } from "./head-loading.js";

/**
 * What a person types into a conversation whose Session is still being
 * created. The ref lets the host that settles the creation read the latest
 * text without waiting for a render.
 */
export function useStartingDraft() {
  const latest = useRef("");
  const [draft, setDraft] = useState("");
  const change = useCallback((text: string) => {
    latest.current = text;
    setDraft(text);
  }, []);
  const read = useCallback(() => latest.current, []);
  const clear = useCallback(() => {
    latest.current = "";
    setDraft("");
  }, []);
  return { draft, change, read, clear };
}

const sameTarget = (
  a: ConversationTarget | null,
  b: ConversationTarget | null,
): boolean =>
  a !== null &&
  b !== null &&
  a.agentId === b.agentId &&
  a.sessionId === b.sessionId;

/** A draft meant for one conversation: no other conversation may take it. */
export type TargetedDraft = Readonly<{
  requestId: string;
  text: string;
  target?: ConversationTarget | undefined;
}>;

/** The draft the open conversation may take, or null when it is for another. */
export function draftFor(
  draft: TargetedDraft | null,
  open: ConversationTarget | null,
): TargetedDraft | null {
  if (draft === null) return null;
  return draft.target === undefined || sameTarget(draft.target, open)
    ? draft
    : null;
}

type Handoff = Readonly<{ target: ConversationTarget; requestId: string }>;

/**
 * The starting pane stays up from the moment a person starts a conversation
 * until the created one is open, and the typed text is part of that
 * conversation's first render, so no key typed in between is overwritten.
 *
 * - `begin` is called through {@link handOffCreated}, with the created target.
 * - `handedOver` is the draft the opened conversation takes; its host calls
 *   `settle` once the composer has it.
 * - If the new Session fails to open, `onFailed` gets the text and the
 *   conversation the person lands on (if any); the host's existing open-error
 *   surface already names the cause, so nothing here reports it again.
 * - Only a hand-off that was actually opening can fail to open: a stale error
 *   left by another choice never moves the draft.
 */
export function useStartHandoff({
  state,
  error,
  draft,
  onFailed,
}: {
  state: ViewState;
  error: string | null;
  draft: ReturnType<typeof useStartingDraft>;
  onFailed: (text: string, returnedTo: ConversationTarget | null) => void;
}) {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const opening = openingTarget(state);
  const open = shownConversation(state);
  const waiting = handoff !== null && sameTarget(opening, handoff.target);
  const arrived = handoff !== null && sameTarget(open, handoff.target);
  const { read, clear } = draft;
  // Read once, when the conversation arrives: the draft keeps one identity.
  const handedOver = useMemo<TargetedDraft | null>(() => {
    if (!arrived) return null;
    const text = read();
    return text.trim() === ""
      ? null
      : { requestId: handoff.requestId, text, target: handoff.target };
  }, [arrived, handoff, read]);
  const settle = useCallback(() => {
    clear();
    setHandoff(null);
  }, [clear]);
  // Set the first time this hand-off's Session is seen opening.
  const wasOpening = useRef(false);
  useEffect(() => {
    if (handoff === null) {
      wasOpening.current = false;
      return;
    }
    if (waiting) wasOpening.current = true;
    if (arrived) {
      if (handedOver === null) settle();
    } else if (!waiting && state.creating === null) {
      // Another choice took over, or the new Session failed to open.
      const text = read();
      if (wasOpening.current && error !== null && text.trim() !== "") {
        onFailed(text, open);
        clear();
      }
      setHandoff(null);
    }
  }, [
    arrived,
    clear,
    error,
    handedOver,
    handoff,
    onFailed,
    open,
    read,
    settle,
    state.creating,
    waiting,
  ]);
  const begin = useCallback((target: ConversationTarget | null) => {
    setHandoff(
      target === null ? null : { target, requestId: correlationKey() },
    );
  }, []);
  return {
    showStarting: state.creating?.cause === "person" || waiting,
    begin,
    handedOver,
    settle,
  };
}

/**
 * Tell the view a created Session exists. The hand-off must commit first and
 * in the same render as the view's change, or one frame shows the old
 * conversation and the starting composer remounts: both updates are applied
 * synchronously, hand-off first.
 */
export function handOffCreated<T>(
  begin: (target: ConversationTarget | null) => void,
  target: ConversationTarget,
  place: () => T,
): T {
  flushSync(() => {
    begin(target);
  });
  return place();
}

/**
 * The new conversation as soon as a person starts it: an empty timeline under
 * the opening treatment and a composer that already takes the draft. Send
 * waits for the Session; the draft then moves into the Session's own
 * composer, and a failed start returns it to the person.
 */
export function StartingConversation({
  agent,
  draft,
  onDraft,
  autoFocus = false,
}: {
  agent?: AppAgent | undefined;
  draft: string;
  onDraft: (text: string) => void;
  autoFocus?: boolean | undefined;
}) {
  return (
    <section
      className="inbox-conversation starting-conversation flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label="New conversation"
      aria-busy="true"
      data-starting-conversation
    >
      <h2 className="m-0 flex h-8 flex-none items-center border-b border-base-300 px-3 text-sm font-medium">
        New conversation
      </h2>
      <div className="flex min-h-0 flex-1 flex-col">
        <HeadLoading agent={agent} message="Starting conversation…" />
      </div>
      <Card className="parakeet-composer-shell mx-2 mb-2 flex-none">
        <Composer
          input={
            <Textarea
              aria-label="Message"
              autoFocus={autoFocus}
              className="font-sans text-base-content"
              placeholder={
                agent === undefined
                  ? "Message agent…"
                  : `Message ${agent.name}…`
              }
              rows={1}
              value={draft}
              onChange={(event) => {
                onDraft(event.target.value);
              }}
            />
          }
          toolbar={
            <span className="text-xs text-dim" role="status">
              Starting…
            </span>
          }
          action={
            <SendAction aria-label="Send message" disabled state="empty" />
          }
        />
      </Card>
    </section>
  );
}
