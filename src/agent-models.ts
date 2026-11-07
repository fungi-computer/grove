import { agentSessionRead, openAppAgent } from "@fungi.computer/agar/agents";
import type { AppRoot } from "@fungi.computer/agar";
import { agentModelListSchema } from "@fungi.computer/shiitake/model-list";

/** Borrow this Agent's read capability; the host, not Grove, decides its list. */
export async function readAgentModels(
  capabilities: AppRoot["capabilities"],
  agentId: string,
  signal: AbortSignal,
  open: typeof openAppAgent = openAppAgent,
) {
  // openAppAgent also supports a send-only transport; a catalog is a read.
  if (!capabilities.has(agentSessionRead))
    throw new Error("Agent read authority is unavailable");
  const transport = await open(capabilities, { agentId });
  try {
    const response = await transport.fetch(
      new Request(`${transport.baseUrl}/models`, { signal }),
    );
    if (!response.ok) throw new Error("Agent model catalog is unavailable");
    return agentModelListSchema.parse(await response.json());
  } finally {
    await transport.close();
  }
}
