import { Button } from "@fungi.computer/caps/components/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@fungi.computer/caps/components/card";
import { useEffect, useRef, useState } from "react";
import type { CapabilityDirectory } from "@fungi.computer/agar";
import { approvals } from "@fungi.computer/agar/approvals";
import {
  MAX_APPROVAL_DENIAL_NOTE_LENGTH,
  type ApprovalAnswerInput,
  type ApprovalView,
  type AutoApproveInput,
} from "@fungi.computer/approvals";

export type ApprovalCardProps = Readonly<{
  view: ApprovalView;
  /** Explicit caller-selected policy scope; never inferred or broadened. */
  scope: AutoApproveInput["scope"];
  capabilities: CapabilityDirectory;
  onViewChange: (view: ApprovalView) => void;
}>;

const stateLabels = {
  requested: "Approval requested.",
  pending: "Pending approval.",
  approved: "Approved. Waiting to run.",
  applied: "Done.",
  denied: "Denied.",
  expired: "Expired. Nothing ran.",
  claimed: "Dispatch in progress.",
  outcome_unknown: "Outcome unknown. Check before trying again.",
} satisfies Record<ApprovalView["record"]["state"], string>;

export function ApprovalCard(props: ApprovalCardProps) {
  const { view, scope } = props;
  // Submission feedback belongs to this owner snapshot and explicit policy scope,
  // never the next record, revision or newly recomputed rights.
  const frame = JSON.stringify([
    view.record.recordId,
    view.record.revision,
    view.canAnswer,
    view.canSetAutoApprove,
    scope.agentId,
  ]);
  return <ApprovalCardFrame key={frame} {...props} />;
}

function ApprovalCardFrame({
  view,
  scope,
  capabilities,
  onViewChange,
}: ApprovalCardProps) {
  const { record } = view;
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [answerBlocked, setAnswerBlocked] = useState(false);
  const [policyBlocked, setPolicyBlocked] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [denialNote, setDenialNote] = useState("");
  const canAnswer =
    view.canAnswer &&
    record.state === "pending" &&
    !answerBlocked &&
    !unavailable;

  async function submit(action: () => Promise<void>, failureMessage: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch {
      setError(failureMessage);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function answer(decision: "approve" | "deny", note?: string) {
    if (!canAnswer) return;
    return submit(async () => {
      const input = {
        recordId: record.recordId,
        decision,
        expectedRevision: record.revision,
      } satisfies ApprovalAnswerInput;
      const result = await capabilities
        .require(approvals)
        .answer(note === undefined ? input : { ...input, denialNote: note });
      setAnswerBlocked(true);
      if (result.kind === "answered" && active.current) {
        onViewChange(result.view);
      } else if (result.kind === "refused") {
        setError(
          "Decision refused. Refresh this approval before answering again.",
        );
      }
    }, "Couldn't submit the decision. Try again.");
  }

  function enableFamily() {
    if (!view.canSetAutoApprove || policyBlocked || unavailable) return;
    return submit(async () => {
      const result = await capabilities.require(approvals).setAutoApprove({
        scope,
        family: { module: record.module, access: record.access },
        enabled: true,
      });
      setPolicyBlocked(true);
      if (result.kind === "updated") {
        setNotice("Automatic approval enabled for this family.");
      } else {
        setError(
          "Policy change refused. Refresh this approval before trying again.",
        );
      }
    }, "Couldn't change approval policy. Try again.");
  }

  function refresh() {
    return submit(async () => {
      const client = capabilities.require(approvals);
      // One bounded pending page, never a feed or a pagination sweep. A settled
      // record or one beyond this page still gets an exact owner lookup.
      const page = await client.list({ state: "pending", limit: 100 });
      const next =
        page.items.find((item) => item.record.recordId === record.recordId) ??
        (await client.get({ recordId: record.recordId }));
      if (!active.current) return;
      setUnavailable(next === null);
      if (next !== null) {
        setAnswerBlocked(false);
        setPolicyBlocked(false);
        onViewChange(next);
      }
    }, "Couldn't refresh this approval. Try again.");
  }

  const refreshButton = (
    <Button variant="ghost" disabled={pending} onClick={() => void refresh()}>
      Refresh approval
    </Button>
  );
  if (unavailable) {
    return (
      <Card
        role="group"
        aria-label="Approval request"
        aria-busy={pending}
        density="compact"
      >
        <CardContent>
          <p role="status">Approval unavailable.</p>
          {error === undefined ? null : <p role="alert">{error}</p>}
        </CardContent>
        <CardFooter>{refreshButton}</CardFooter>
      </Card>
    );
  }

  return (
    <Card
      role="group"
      aria-label="Approval request"
      aria-busy={pending}
      density="compact"
    >
      <CardHeader>
        <CardTitle>
          {canAnswer ? "Allow " : ""}
          {record.module} · {record.operation}
          {canAnswer ? "?" : ""}
        </CardTitle>
        <p>{record.requester.displayName} wants to use a connected tool.</p>
      </CardHeader>
      <CardContent className="min-w-0 space-y-2">
        <p>
          Effect{" "}
          {record.access === "write"
            ? "Changes data in Fungi"
            : "Changes things outside Fungi"}
          {record.reversibility === "irreversible-external"
            ? " · can't be undone"
            : ""}
        </p>
        {canAnswer ? null : <p role="status">{stateLabels[record.state]}</p>}
        {explaining && canAnswer ? (
          <div className="space-y-2">
            <label htmlFor={`denial-note-${record.recordId}`}>Why deny?</label>
            <input
              id={`denial-note-${record.recordId}`}
              aria-label="Why deny?"
              type="text"
              maxLength={MAX_APPROVAL_DENIAL_NOTE_LENGTH}
              value={denialNote}
              onChange={(event) => {
                setDenialNote(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setExplaining(false);
                  setDenialNote("");
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  void answer("deny", denialNote.trim() || undefined);
                }
              }}
            />
            <Button
              disabled={pending}
              onClick={() =>
                void answer("deny", denialNote.trim() || undefined)
              }
            >
              Send denial
            </Button>
          </div>
        ) : null}
        <details>
          <summary>Details</summary>
          <p>Requester: {record.requester.principalId}</p>
          <p>
            Agent: {record.requester.displayName} ·{" "}
            {record.requester.agentId ?? "none"}
          </p>
          <p>Session: {record.requester.sessionId ?? "none"}</p>
          <p>
            Request: {record.module}.{record.operation} · {record.access}
          </p>
          <p>
            Undo:{" "}
            {record.reversibility === "irreversible-external"
              ? "Can't be undone"
              : "Can be undone"}
          </p>
          <p>Can answer: {view.canAnswer ? "Yes" : "No"}</p>
          <p>Can set auto-approve: {view.canSetAutoApprove ? "Yes" : "No"}</p>
          {record.by?.kind === "policy" ? <p>Auto-approved by policy</p> : null}
          <p>{record.description.title}</p>
          <p className="break-all">
            Input: {record.description.inputBytes} bytes · SHA-256{" "}
            {record.description.inputSha256}
          </p>
          <p>
            Record: {record.recordId} · revision {record.revision}
          </p>
          {view.canSetAutoApprove ? (
            <p>
              Policy scope:{" "}
              {scope.agentId === null ? "whole home" : `agent ${scope.agentId}`}
            </p>
          ) : null}
        </details>
        {notice === undefined ? null : <p role="status">{notice}</p>}
        {error === undefined ? null : <p role="alert">{error}</p>}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          disabled={pending || !canAnswer}
          onClick={() => void answer("approve")}
        >
          Approve once
        </Button>
        <Button
          variant="outline"
          disabled={pending || !canAnswer}
          onClick={() => void answer("deny")}
        >
          Deny
        </Button>
        <Button
          variant="outline"
          disabled={pending || !canAnswer}
          onClick={() => {
            setDenialNote("");
            setExplaining(true);
          }}
        >
          Deny and say why…
        </Button>
        {view.canSetAutoApprove ? (
          <Button
            variant="ghost"
            disabled={pending || policyBlocked}
            onClick={() => void enableFamily()}
          >
            Always approve this family
          </Button>
        ) : null}
        {refreshButton}
      </CardFooter>
    </Card>
  );
}
