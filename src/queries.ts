import type { AppRoot } from "@fungi.computer/agar";
import {
  agentExtensions,
  agentList,
  agentInstructions,
  agentManage,
  agentSessionRead,
  agentSessionWrite,
  agentToolPolicy,
  createAppAgent,
  listAppAgentComputers,
  readAppAgentInstructions,
  renameAppAgent,
  setAppAgentInstructions,
  setAppAgentAvatar,
  type AppAgent,
  type AppAgentAvatarInput,
  type AppAgentCreateInput,
  type AppAgentExtensions,
  type AppAgentExtensionsResult,
  type AppAgentInstructions,
  type AppAgentToolPolicyStatus,
} from "@fungi.computer/agar/agents";
import {
  capabilityQuery,
  queryKeys,
  useMemberInbox,
} from "@fungi.computer/agar/query";
import type { MemberInboxSession } from "@fungi.computer/agar/inbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/** The host owns directory and inbox data; Query owns their shared lifetime. */
export function useInboxData(app: AppRoot | null) {
  const client = useQueryClient();
  const canRead =
    app?.capabilities.has(agentSessionRead) === true ||
    app?.capabilities.has(agentSessionWrite) === true;
  const feed = useMemberInbox(canRead ? app : null);
  const inbox = app && !canRead ? { ...feed, status: "live" as const } : feed;
  const directoryKey = queryKeys.of(app, "agents");
  const directory = useQuery({
    ...capabilityQuery(app, agentList, directoryKey, (handle) => handle.list()),
    enabled: app?.capabilities.has(agentList) === true,
  });
  const { refetch } = directory;
  const previousActivity = useRef<{ app: AppRoot; key: string } | null>(null);
  // An Agent can change its own identity during a turn, and a turn ends in a
  // Session state change. The Inbox's pushed state transitions refresh the same
  // directory Query a person's rename updates; no second cache or polling. A
  // Session's activity time moves with every message and cannot change an
  // Agent's identity, so it is not part of the key. The app contract exposes no
  // directory revision to key on instead.
  useEffect(() => {
    if (app === null || !directory.isSuccess || inbox.status !== "live") return;
    const sessions = inbox.items.filter(
      (item): item is MemberInboxSession => !("kind" in item),
    );
    if (sessions.length === 0) return;
    const key = JSON.stringify(
      sessions.map((item) => [item.agentId, item.sessionId, item.state]),
    );
    const changed =
      previousActivity.current?.app === app &&
      previousActivity.current.key !== key;
    previousActivity.current = { app, key };
    const knownAgents = new Set(directory.data.map((agent) => agent.agentId));
    if (changed || sessions.some((item) => !knownAgents.has(item.agentId)))
      void refetch();
  }, [
    app,
    directory.isSuccess,
    directory.data,
    inbox.status,
    inbox.items,
    refetch,
  ]);
  // The Team Computers New Agent offers, newest first; null when the host
  // makes no creation-time Computer choice.
  const computerChoicesKey = queryKeys.of(app, "agent-computers");
  const computerChoices = useQuery({
    ...capabilityQuery(app, agentManage, computerChoicesKey, () => {
      if (!app) throw new Error("No App connection");
      return listAppAgentComputers(app.capabilities);
    }),
    enabled: app?.capabilities.has(agentManage) === true,
  });
  const createAgent = useMutation({
    mutationFn: (intent: AppAgentCreateInput) => {
      if (!app) throw new Error("No App connection");
      return createAppAgent(app.capabilities, intent);
    },
    onMutate: () => ({ directoryKey }),
    onSettled: (_agent, _error, intent) => {
      // A new Computer joins the Team's list for the next Agent.
      if (intent.computer === "new")
        void client.invalidateQueries({ queryKey: computerChoicesKey });
    },
    onSuccess: (agent, _intent, context) => {
      client.setQueryData<readonly AppAgent[]>(
        context.directoryKey,
        (previous = []) =>
          previous.some((item) => item.agentId === agent.agentId)
            ? previous
            : [...previous, agent],
      );
    },
  });
  const renameAgent = useMutation({
    mutationFn: (intent: { agentId: string; name: string }) => {
      if (!app) throw new Error("No App connection");
      return renameAppAgent(app.capabilities, intent);
    },
    onSuccess: (agent) => {
      client.setQueryData<readonly AppAgent[]>(directoryKey, (previous = []) =>
        previous.map((item) => (item.agentId === agent.agentId ? agent : item)),
      );
    },
  });
  const setAgentAvatar = useMutation({
    mutationFn: (intent: AppAgentAvatarInput) => {
      if (!app) throw new Error("No App connection");
      return setAppAgentAvatar(app.capabilities, intent);
    },
    onSuccess: (agent) => {
      client.setQueryData<readonly AppAgent[]>(directoryKey, (previous = []) =>
        previous.map((item) => (item.agentId === agent.agentId ? agent : item)),
      );
    },
  });
  return {
    directory,
    inbox,
    computerChoices,
    createAgent,
    renameAgent,
    setAgentAvatar,
  };
}

/** Whether the open Agent's App-tool policy still awaits the owner's approval. */
export function useAgentToolPolicy(
  app: AppRoot | null,
  agentId: string | null,
) {
  const client = useQueryClient();
  const canRead = app?.capabilities.has(agentToolPolicy) === true;
  const statusKey = queryKeys.of(app, "agent-tool-policy", agentId ?? "none");
  const status = useQuery({
    ...capabilityQuery(app, agentToolPolicy, statusKey, (handle) =>
      agentId === null ? Promise.resolve(null) : handle.status({ agentId }),
    ),
    enabled: canRead && agentId !== null,
  });
  const approve = useMutation({
    mutationFn: (input: {
      agentId: string;
      expectedRevision: string | null;
    }) => {
      if (!app) throw new Error("No App connection");
      return app.capabilities.require(agentToolPolicy).approve({
        agentId: input.agentId,
        level: "write",
        expectedRevision: input.expectedRevision,
      });
    },
    onSuccess: (result) => {
      if (!("error" in result))
        client.setQueryData<AppAgentToolPolicyStatus>(statusKey, result);
    },
  });
  return { canRead, status, approve };
}

/** The hosted extensions on the open Agent: what is attached and what its owner could attach. */
export function useAgentExtensions(
  app: AppRoot | null,
  agentId: string | null,
) {
  const client = useQueryClient();
  const canUse = app?.capabilities.has(agentExtensions) === true;
  const key = queryKeys.of(app, "agent-extensions", agentId ?? "none");
  const read = useQuery({
    ...capabilityQuery(app, agentExtensions, key, (handle) =>
      agentId === null ? Promise.resolve(null) : handle.list({ agentId }),
    ),
    enabled: canUse && agentId !== null,
  });
  const change = useMutation({
    mutationFn: (input: {
      agentId: string;
      installationId: string;
      kind: "attach" | "detach";
    }): Promise<AppAgentExtensionsResult> => {
      if (!app) throw new Error("No App connection");
      const handle = app.capabilities.require(agentExtensions);
      const { agentId: id, installationId } = input;
      return input.kind === "attach"
        ? handle.attach({ agentId: id, installationId })
        : handle.detach({ agentId: id, installationId });
    },
    onSuccess: (result, input) => {
      // A refusal changes nothing; the list stays as the host last read it.
      if (!("error" in result))
        client.setQueryData<AppAgentExtensions | null>(
          queryKeys.of(app, "agent-extensions", input.agentId),
          result,
        );
    },
  });
  return { canUse, read, change };
}

/** The AGENTS.md on the open Agent's Home Computer, readable and savable by its owner. */
export function useAgentInstructions(
  app: AppRoot | null,
  agentId: string | null,
) {
  const client = useQueryClient();
  const canUse = app?.capabilities.has(agentInstructions) === true;
  const key = queryKeys.of(app, "agent-instructions", agentId ?? "none");
  const read = useQuery({
    ...capabilityQuery(app, agentInstructions, key, () => {
      if (!app || agentId === null) throw new Error("No Agent is open");
      return readAppAgentInstructions(app.capabilities, agentId);
    }),
    enabled: canUse && agentId !== null,
  });
  const save = useMutation({
    mutationFn: (input: {
      agentId: string;
      expectedContent: string | null;
      content: string;
    }) => {
      if (!app) throw new Error("No App connection");
      return setAppAgentInstructions(app.capabilities, input);
    },
    onSuccess: (saved) => {
      client.setQueryData<AppAgentInstructions>(
        queryKeys.of(app, "agent-instructions", saved.agentId),
        saved,
      );
    },
  });
  return { canUse, read, save };
}
