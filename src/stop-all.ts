import type { AppRoot } from "@fungi.computer/agar";
import {
  agentStopAllSummary,
  stopAppAgentTree,
} from "@fungi.computer/agar/agents";

/**
 * Stop all from Grove: stop the Agent and every Agent it spawned through the
 * host, then show one toast naming what stopped and each Agent whose stop is
 * unconfirmed, with its cause. A refused request confirms no stop at all.
 */
export async function stopAgentTree(
  app: Pick<AppRoot, "capabilities" | "ui">,
  agentId: string,
): Promise<void> {
  const toast = await stopAppAgentTree(app.capabilities, { agentId }).then(
    agentStopAllSummary,
    (cause: unknown) =>
      ({
        tone: "warning",
        message: `Stop all unconfirmed: ${cause instanceof Error ? cause.message : String(cause)}`,
      }) satisfies ReturnType<typeof agentStopAllSummary>,
  );
  await app.ui.showToast(toast).catch((cause: unknown) => {
    console.error("Stop all toast failed", cause);
  });
}
