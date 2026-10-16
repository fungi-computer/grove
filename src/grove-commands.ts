import { registerCatalog, type AppRoot } from "@fungi.computer/agar";
import {
  createWhistle,
  type WhistleCommand,
  type WhistleRuntime,
} from "@fungi.computer/whistle";
import { useEffect, useMemo, useRef } from "react";

/** What Grove's own commands do in the live inbox. */
export type GroveCommandActions = Readonly<{
  /** Start a new conversation with the open conversation's Agent. */
  newConversation: () => void;
  /** Ask the host to show Grove's App permissions. */
  openPermissions: () => void;
}>;

/**
 * Grove's catalog, defined once: slash commands in its composer, and the same
 * commands in the shell's `:` line while Grove is focused.
 */
export function groveCommands(
  actions: () => GroveCommandActions,
): readonly WhistleCommand<never>[] {
  return [
    {
      id: "new-conversation",
      title: "New conversation",
      category: "Conversation",
      description: "Start a new conversation with this Agent",
      projections: { slash: { aliases: ["new"], order: 20 }, palette: {} },
      handler: () => {
        actions().newConversation();
      },
    },
    {
      id: "permissions",
      title: "App permissions",
      category: "Conversation",
      description: "Review what Grove may access",
      projections: {
        slash: { aliases: ["permissions"], order: 21 },
        palette: {},
      },
      handler: () => {
        actions().openPermissions();
      },
    },
  ];
}

/**
 * The composer's command runtime: Grove's own catalog. Parakeet adds its
 * built-ins and the open Session's extension commands to the same runtime, so
 * the chat box shows only Grove's and that Session's commands.
 */
export function useGroveCommands(
  actions: GroveCommandActions,
  host: AppRoot["commands"] | undefined,
): WhistleRuntime {
  const latest = useRef(actions);
  latest.current = actions;
  const catalog = useMemo(() => groveCommands(() => latest.current), []);
  const runtime = useMemo(() => createWhistle(), []);
  useEffect(() => {
    const lease = runtime.contribute({
      sourceId: "grove",
      namespace: "grove",
      commands: catalog,
    });
    return () => {
      lease.dispose();
    };
  }, [catalog, runtime]);
  useEffect(
    () => (host ? registerCatalog(host, catalog) : undefined),
    [catalog, host],
  );
  return runtime;
}
