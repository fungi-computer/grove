import { Button } from "@fungi.computer/caps/components/button";
import type { AppAgentToolPolicyStatus } from "@fungi.computer/agar/agents";

/**
 * Owner-only recovery control: an Agent's App tools can be left pending (a
 * stale membership lookup at creation, or an Agent made before this
 * control existed). Approving reuses the same owner-direct policy path a
 * fresh Agent is approved through at creation.
 */
export function AllowAppToolsControl({
  status,
  approving,
  onApprove,
}: {
  status: AppAgentToolPolicyStatus | null | undefined;
  approving: boolean;
  onApprove: () => void;
}) {
  if (status?.status !== "pending") return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="flex-none"
      loading={approving}
      disabled={approving}
      onClick={onApprove}
    >
      Allow App tools
    </Button>
  );
}
