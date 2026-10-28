import { Button } from "@fungi.computer/caps/components/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@fungi.computer/caps/components/card";
import type { ApprovalView, AutoApproveInput } from "@fungi.computer/approvals";
import { useParakeetInteractions } from "@fungi.computer/parakeet/headless";
import {
  useApprovalOwners,
  type ApprovalOwnersApi,
} from "./approval-owners.js";

export type ApprovalCardProps = Readonly<{
  view: ApprovalView;
  /** Explicit caller-selected policy scope; never inferred or broadened. */
  scope: AutoApproveInput["scope"];
  /** Read the record again from its owner. */
  onRefresh: () => void;
  /** Bring the question back to the composer after Later. */
  onAnswer: () => void;
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

/**
 * What the tool row says about an approval: its state, and its facts under
 * Details. The question itself is asked in the composer.
 */
export function ApprovalCard({
  view,
  scope,
  onRefresh,
  onAnswer,
}: ApprovalCardProps) {
  const { record } = view;
  const asking = view.canAnswer && record.state === "pending";
  return (
    <Card role="group" aria-label="Approval request" density="compact">
      <CardHeader>
        <CardTitle>
          {asking ? "Allow " : ""}
          {record.module} · {record.operation}
          {asking ? "?" : ""}
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
        <p role="status">
          {asking ? "Waiting for your answer." : stateLabels[record.state]}
        </p>
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
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {asking ? (
          <Button variant="outline" onClick={onAnswer}>
            Answer
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onRefresh}>
          Refresh approval
        </Button>
      </CardFooter>
    </Card>
  );
}

/** The row a tool call shows for its pending approval, once its owner has read it. */
export function ApprovalRow({ recordId }: Readonly<{ recordId: string }>) {
  const owners: ApprovalOwnersApi | undefined = useApprovalOwners();
  const interactions = useParakeetInteractions();
  const entry = owners?.entry(recordId);
  if (owners === undefined || entry === undefined) return null;
  if (entry.failed)
    return (
      <div>
        <p role="alert">Couldn't load this approval. Try again.</p>
        <Button
          variant="ghost"
          onClick={() => {
            owners.refresh(recordId);
          }}
        >
          Refresh approval
        </Button>
      </div>
    );
  if (entry.view === null || entry.view.record.state === "expired") return null;
  return (
    <ApprovalCard
      view={entry.view}
      scope={{ agentId: owners.agentId }}
      onRefresh={() => {
        owners.refresh(recordId);
      }}
      onAnswer={() => {
        interactions.awaiting.focus();
      }}
    />
  );
}
