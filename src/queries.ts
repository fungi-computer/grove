import type { MemberInboxSession } from "@fungi.computer/agar/inbox";
import type { AppRoot } from "@fungi.computer/agar";
import {
  agentList,
  agentSessionRead,
  agentSessionWrite,
  agentToolPolicy,
  createAppAgent,
  renameAppAgent,
  setAppAgentAvatar,
  type AppAgent,
  type AppAgentAvatarInput,
  type AppAgentCreateInput,
  type AppAgentToolPolicyStatus,
} from "@fungi.computer/agar/agents";
import {
  capabilityQuery,
  queryKeys,
  useMemberInbox,
} from "@fungi.computer/agar/query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

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
  const knownAgents = new Set(directory.data?.map((agent) => agent.agentId));
  const unknownAgents = !directory.isSuccess
    ? "[]"
    : JSON.stringify(
        [
          ...new Set(
            inbox.items
              .filter((item): item is MemberInboxSession => !("kind" in item))
              .map((item) => item.agentId),
          ),
        ]
          .filter((agentId) => !knownAgents.has(agentId))
          .sort(),
      );
  const { refetch } = directory;
  useEffect(() => {
    if (unknownAgents !== "[]" && inbox.items.length > 0) void refetch();
  }, [unknownAgents, inbox.items, refetch]);
  const createAgent = useMutation({
    mutationFn: (intent: AppAgentCreateInput) => {
      if (!app) throw new Error("No App connection");
      return createAppAgent(app.capabilities, intent);
    },
    onMutate: () => ({ directoryKey }),
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
  return { directory, inbox, createAgent, renameAgent, setAgentAvatar };
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
