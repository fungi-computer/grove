import { AgentHead, ShiitakeAvatar } from "@fungi.computer/parakeet";
import type { AppAgent } from "@fungi.computer/agar/agents";

/**
 * The widget's one loading state: a head, thinking, where the greeting's head
 * will sit, so it turns into "Hi, I’m Shiitake" in place. Once the Agent is
 * known the head is its own, the same one the greeting draws, so nothing
 * changes colour; before that (the directory is still loading) it is
 * Shiitake the mascot, the same Sprite character.
 */
export function HeadLoading({
  agent,
  message,
}: {
  agent?: AppAgent | undefined;
  message: string;
}) {
  return (
    <div
      className="m-auto flex flex-col items-center gap-sm text-center"
      data-head-loading
      role="status"
    >
      {agent === undefined ? (
        <ShiitakeAvatar
          className="chat-gill-hero size-[72px] shrink-0"
          state={{ activity: "thinking", expression: "normal" }}
        />
      ) : (
        <AgentHead
          activity="thinking"
          avatar={agent.avatar}
          className="chat-gill-hero"
          name={agent.name}
          size={72}
        />
      )}
      <p className="text-sm text-dim">{message}</p>
    </div>
  );
}
