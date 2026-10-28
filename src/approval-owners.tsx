import { approvals } from "@fungi.computer/agar/approvals";
import type { CapabilityDirectory } from "@fungi.computer/agar";
import {
  MAX_APPROVAL_DENIAL_NOTE_LENGTH,
  PendingApprovalSchema,
  type ApprovalView,
} from "@fungi.computer/approvals";
import {
  useApprovalAwaiting,
  useParakeetInteractions,
  useTimeline,
  type ApprovalSource,
  type ParakeetToolItem,
} from "@fungi.computer/parakeet/headless";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const decodePendingApproval = Schema.decodeUnknownOption(
  Schema.fromJsonString(PendingApprovalSchema),
  { onExcessProperty: "error" },
);

/** The record a settled tool result points at, when it is a pending approval. */
export function pendingApprovalId(item: ParakeetToolItem): string | undefined {
  if (item.status !== "completed" || item.result?.isError) return undefined;
  for (const part of item.result?.content ?? []) {
    if (part.type !== "text") continue;
    const pending = decodePendingApproval(part.text);
    if (Option.isSome(pending)) return pending.value.recordId;
  }
  return undefined;
}

/** What Grove currently knows about one approval its owner can read. */
type ApprovalEntry = Readonly<{
  /** The owner's current view; null when the owner no longer exposes it. */
  view: ApprovalView | null;
  /** Reading it failed. */
  failed: boolean;
}>;

/** What tool rows read from the approvals the conversation owns. */
export type ApprovalOwnersApi = Readonly<{
  entry: (
    recordId: string,
  ) => Readonly<{ view: ApprovalView | null; failed: boolean }> | undefined;
  /** Read the record again from its owner. */
  refresh: (recordId: string) => void;
  /** The policy scope an approval's family rule would apply to. */
  agentId: string;
}>;

const OwnersContext = createContext<ApprovalOwnersApi | undefined>(undefined);

/** Grove's approval owners: what the tool rows show about each pending record. */
export function useApprovalOwners(): ApprovalOwnersApi | undefined {
  return useContext(OwnersContext);
}

const answerFailure =
  "Couldn't send your answer. It may not have been recorded.";

/**
 * One pending record, owned for as long as the conversation lists it, whether
 * or not its tool row is scrolled into view. The owner supplies the current
 * view and rights; the composer asks about it and sends the answer here.
 */
function ApprovalOwner({
  recordId,
  attempt,
  capabilities,
  agentId,
  publish,
}: Readonly<{
  recordId: string;
  attempt: number;
  capabilities: CapabilityDirectory;
  agentId: string;
  publish: (recordId: string, entry: ApprovalEntry) => void;
}>) {
  const store = useParakeetInteractions();
  const [view, setView] = useState<ApprovalView | null>();
  const latest = useRef<ApprovalView | undefined>(undefined);
  const listeners = useRef(new Set<() => void>());
  const show = useCallback(
    (next: ApprovalView | null) => {
      latest.current = next ?? undefined;
      setView(next);
      publish(recordId, { view: next, failed: false });
      for (const listener of listeners.current) listener();
    },
    [publish, recordId],
  );
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
        if (active) publish(recordId, { view: null, failed: true });
      }
    }
    void read();
    return () => {
      active = false;
    };
  }, [capabilities, recordId, attempt, show, publish]);
  const answerable =
    view?.canAnswer === true && view.record.state === "pending";
  const family = view?.canSetAutoApprove === true;
  const module = view?.record.module;
  const access = view?.record.access;
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
              label: "Always approve this family",
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
  }, [answerable, capabilities, agentId, family, module, access, show]);
  useApprovalAwaiting({
    source,
    store,
    enabled: true,
    home: "",
    width: 72,
    noteLimit: MAX_APPROVAL_DENIAL_NOTE_LENGTH,
    onFailure: reportAnswerFailure,
  });
  return null;
}

function reportAnswerFailure(cause: unknown) {
  console.warn(answerFailure, cause);
}

/**
 * Own every pending approval the conversation lists: each is read from its
 * member-bound owner and put in the composer's queue. Tool rows only show
 * what is known about them.
 */
export function ApprovalOwners({
  capabilities,
  agentId,
  children,
}: Readonly<{
  capabilities: CapabilityDirectory | undefined;
  agentId: string;
  children: ReactNode;
}>) {
  const timeline = useTimeline();
  const ids = useMemo(() => {
    const found = new Set<string>();
    for (const item of [...timeline.settled, ...timeline.tail])
      if (item.kind === "tool_group")
        for (const tool of item.tools) {
          const id = pendingApprovalId(tool);
          if (id !== undefined) found.add(id);
        }
    return [...found];
  }, [timeline.settled, timeline.tail]);
  const [entries, setEntries] = useState<ReadonlyMap<string, ApprovalEntry>>(
    new Map(),
  );
  const [attempts, setAttempts] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  const publish = useCallback((recordId: string, entry: ApprovalEntry) => {
    setEntries((current) => new Map(current).set(recordId, entry));
  }, []);
  const owners = useMemo<ApprovalOwnersApi>(
    () => ({
      entry: (recordId) => entries.get(recordId),
      refresh: (recordId) => {
        setAttempts((current) =>
          new Map(current).set(recordId, (current.get(recordId) ?? 0) + 1),
        );
      },
      agentId,
    }),
    [entries, agentId],
  );
  return (
    <OwnersContext.Provider
      value={capabilities === undefined ? undefined : owners}
    >
      {capabilities === undefined
        ? null
        : ids.map((recordId) => (
            <ApprovalOwner
              key={recordId}
              recordId={recordId}
              attempt={attempts.get(recordId) ?? 0}
              capabilities={capabilities}
              agentId={agentId}
              publish={publish}
            />
          ))}
      {children}
    </OwnersContext.Provider>
  );
}
