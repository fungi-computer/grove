import {
  parseSessionFrame,
  parseSessionSnapshot,
  type SessionFrame,
  type ShiitakeSession,
} from "@fungi.computer/shiitake/client";
import captured from "../test/fixtures/live-tool-output.frames.json" with { type: "json" };

/** The proof's hand on the replay: one real frame per step. */
type LiveToolOutputReplay = Readonly<{
  /** Deliver the next captured frame; false when none remain. */
  step: () => boolean;
  /** The captured frame count not yet delivered. */
  remaining: () => number;
}>;

/**
 * Replay the frames a Hub Agent session sent while a command ran on its
 * Computer. The session wire's own parsers decode them, so a frame the real
 * wire could not carry never reaches Grove.
 */
export function replayLiveToolOutput(base: ShiitakeSession): ShiitakeSession {
  const snapshot = parseSessionSnapshot(JSON.stringify(captured.snapshot));
  const frames = captured.frames.map((frame) =>
    parseSessionFrame(JSON.stringify(frame)),
  );
  const queue: SessionFrame[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  let next = 0;
  const replay: LiveToolOutputReplay = {
    step: () => {
      if (next >= frames.length) return false;
      queue.push(frames[next]);
      next += 1;
      wake?.();
      return true;
    },
    remaining: () => frames.length - next,
  };
  Reflect.set(globalThis, "groveLiveToolOutput", replay);
  async function* changes(): AsyncGenerator<SessionFrame> {
    while (!closed) {
      if (queue.length === 0)
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      while (queue.length > 0) {
        const frame = queue.shift();
        if (frame !== undefined) yield frame;
      }
    }
  }
  return {
    ...base,
    read: () => Promise.resolve(snapshot),
    subscribe: changes,
    watch: () =>
      Promise.resolve({
        snapshot,
        changes: changes(),
        close: () => {
          closed = true;
          wake?.();
          return Promise.resolve();
        },
      }),
  };
}
