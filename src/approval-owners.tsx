import { approvals } from "@fungi.computer/agar/approvals";
import type { CapabilityDirectory } from "@fungi.computer/agar";
import {
  MAX_APPROVAL_DENIAL_NOTE_LENGTH,
  type ApprovalView,
} from "@fungi.computer/approvals";
import {
  useApprovalAwaiting,
  useParakeetInteractions,
  useTimeline,
  type ApprovalSource,
} from "@fungi.computer/parakeet/headless";
import { useWaitingRecordIds } from "./approval-awaiting.js";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const answerFailure =
  "Couldn't send your answer. It may not have been recorded.";

/**
 * One pending record, owned for as long as the conversation lists it, whether
 * or not its tool row is scrolled into view. The owner supplies the current
 * view and rights; the composer asks about it and sends the answer here.
 */
function ApprovalOwner({
  recordId,
  capabilities,
  agentId,
}: Readonly<{
  recordId: string;
  capabilities: CapabilityDirectory;
  agentId: string;
}>) {
  const store = useParakeetInteractions();
  const [view, setView] = useState<ApprovalView | null>();
  const latest = useRef<ApprovalView | undefined>(undefined);
  const listeners = useRef(new Set<() => void>());
  const show = useCallback((next: ApprovalView | null) => {
    latest.current = next ?? undefined;
    setView(next);
    for (const listener of listeners.current) listener();
  }, []);
  useEffect(() => {
    // Never carry a previous holder's metadata across a capability replacement.
    latest.current = undefined;
    setView(undefined);
  }, [capabilities]);
  useEffect(() => {
    let active = true;
    async function read() {
      try {
        const next = await capabilities.require(approvals).get({ recordId });
        if (active) show(next);
      } catch (cause) {
        console.warn("Grove could not read the approval", cause);
      }
    }
    void read();
    return () => {
      active = false;
    };
  }, [capabilities, recordId, show]);
  const answerable =
    view?.canAnswer === true && view.record.state === "pending";
  const family = view?.canSetAutoApprove === true;
  const module = view?.record.module;
  const access = view?.record.access;
  const appName = view?.record.description.app?.displayName ?? "this App";
  const source = useMemo<ApprovalSource | undefined>(() => {
    if (!answerable) return undefined;
    return {
      snapshot: () => latest.current,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
      answer: async (input) => {
        const client = capabilities.require(approvals);
        const answer =
          input.decision === "always-allow"
            ? undefined
            : {
                recordId: input.recordId,
                decision: input.decision,
                expectedRevision: input.expectedRevision,
              };
        if (answer === undefined)
          return { kind: "refused", reason: "not-eligible" };
        const result = await client.answer(
          input.denialNote === undefined
            ? answer
            : { ...answer, denialNote: input.denialNote },
        );
        // The owner's returned view, never an assumption that the answer applied.
        if (result.kind === "answered") show(result.view);
        return result;
      },
      family:
        !family || module === undefined || access === undefined
          ? undefined
          : {
              label: `Always allow ${appName} to ${access === "write" ? "make changes" : "act outside Fungi"}`,
              enable: async () => {
                const result = await capabilities
                  .require(approvals)
                  .setAutoApprove({
                    scope: { agentId },
                    family: { module, access },
                    enabled: true,
                  });
                return result.kind === "updated";
              },
            },
    };
  }, [
    answerable,
    capabilities,
    agentId,
    family,
    module,
    access,
    appName,
    show,
  ]);
  // A member who cannot answer is told once, in a line beside a composer that
  // stays usable: the request waits for someone who can.
  const waitingOnOthers = view?.record.state === "pending" && !view.canAnswer;
  useEffect(() => {
    if (!waitingOnOthers) return undefined;
    const message = `Waiting for approval from someone who can use ${appName}.`;
    store.report({ tone: "info", message });
    return () => {
      if (store.snapshot().notice?.message === message) store.report(undefined);
    };
  }, [waitingOnOthers, appName, store]);
  useApprovalAwaiting({
    source,
    store,
    enabled: true,
    home: "",
    width: 72,
    noteLimit: MAX_APPROVAL_DENIAL_NOTE_LENGTH,
    onFailure: reportAnswerFailure,
    onUnshowable: (message) => {
      store.toast({ variant: "error", message });
    },
  });
  return null;
}

function reportAnswerFailure(cause: unknown) {
  console.warn(answerFailure, cause);
}

/**
 * Own every approval this Session has parked: each is read from its
 * member-bound owner and put in the composer's queue, where the question is
 * asked. A card disappears when it is answered, withdrawn or expired.
 */
export function ApprovalOwners({
  capabilities,
  agentId,
  sessionId,
  children,
}: Readonly<{
  capabilities: CapabilityDirectory | undefined;
  agentId: string;
  sessionId: string;
  children: ReactNode;
}>) {
  const timeline = useTimeline();
  const running = useMemo(
    () =>
      [...timeline.settled, ...timeline.tail].some(
        (item) =>
          item.kind === "tool_group" &&
          item.tools.some((tool) => tool.status === "running"),
      ),
    [timeline.settled, timeline.tail],
  );
  const ids = useWaitingRecordIds(capabilities, agentId, sessionId, running);
  return (
    <>
      {capabilities === undefined
        ? null
        : ids.map((recordId) => (
            <ApprovalOwner
              key={recordId}
              recordId={recordId}
              capabilities={capabilities}
              agentId={agentId}
            />
          ))}
      {children}
    </>
  );
}
