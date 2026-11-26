import { approvals } from "@fungi.computer/agar/approvals";
import type { CapabilityDirectory } from "@fungi.computer/agar";
import { sessionKey } from "./inbox-model.js";
import { useEffect, useState } from "react";

/** How often a running tool call is asked what it is waiting on. */
const POLL_MS = 2000;
/**
 * How often an open conversation looks when nothing reports a running call.
 * Whether live activity marks a call that waits on a person as running depends
 * on the rail that runs the Agent (a run on a celld exec shard never found its
 * approval while this signal gated the poll), so an open conversation must
 * still find its approval, only more slowly.
 */
const IDLE_POLL_MS = 5000;

/**
 * The records this Session has parked for a person. A write that needs
 * approval ends its call at once, so no tool result names its record: the
 * owner lists the pending records every few seconds while the conversation is
 * open, faster while any call is running. A card stays until it is answered,
 * withdrawn with its Session or expired; it never depends on a live call.
 */
export function useWaitingRecordIds(
  capabilities: CapabilityDirectory | undefined,
  agentId: string,
  sessionId: string,
  running: boolean,
): readonly string[] {
  const [ids, setIds] = useState<readonly string[]>([]);
  useEffect(() => {
    if (capabilities === undefined) {
      setIds([]);
      return;
    }
    const directory = capabilities;
    let active = true;
    async function read() {
      try {
        const page = await directory
          .require(approvals)
          .list({ state: "pending", limit: 100 });
        const next = page.items
          .filter(
            (view) =>
              view.record.requester.agentId === agentId &&
              view.record.requester.sessionId === sessionId,
          )
          .map((view) => view.record.recordId);
        if (active)
          setIds((current) =>
            current.join() === next.join() ? current : next,
          );
      } catch (cause) {
        console.warn("Grove could not list pending approvals", cause);
      }
    }
    void read();
    const timer = setInterval(
      () => void read(),
      running ? POLL_MS : IDLE_POLL_MS,
    );
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [capabilities, agentId, sessionId, running]);
  return ids;
}

/**
 * Which conversations have an approval parked for a person, so a conversation
 * that is not open still shows it is waiting. Read every few seconds while the
 * list is on screen; a failed read keeps the last answer.
 */
export function useAwaitingApprovalSessions(
  capabilities: CapabilityDirectory | undefined,
): ReadonlySet<string> {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!capabilities?.has(approvals)) {
      setKeys(new Set());
      return;
    }
    const directory = capabilities;
    let active = true;
    async function read() {
      try {
        const page = await directory
          .require(approvals)
          .list({ state: "pending", limit: 100 });
        const next = new Set(
          page.items.flatMap((view) => {
            const { agentId, sessionId } = view.record.requester;
            return view.canAnswer && agentId !== null && sessionId !== null
              ? [sessionKey(agentId, sessionId)]
              : [];
          }),
        );
        if (active)
          setKeys((current) =>
            [...current].sort().join() === [...next].sort().join()
              ? current
              : next,
          );
      } catch (cause) {
        console.warn("Grove could not list pending approvals", cause);
      }
    }
    void read();
    const timer = setInterval(() => void read(), IDLE_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [capabilities]);
  return keys;
}
