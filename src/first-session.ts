import * as Schema from "effect/Schema";
import type { AppStorage } from "@fungi.computer/agar/storage";

/** The member storage key Grove declares for its automatic first Session. */
export const firstSessionStorageKey = "first-session";

const decodeClaim = Schema.decodeUnknownSync(
  Schema.Struct({ requestId: Schema.NonEmptyString }),
);

export type FirstSessionStorage = Pick<AppStorage, "claim">;

/**
 * The one creation request ID for the conversation Grove opens on its own.
 *
 * Grove's window and its chat widget run in separate frames, and each starts
 * a conversation when the member has none listed. Both claim their request ID
 * in the member's App storage: the first claim stores its ID and every other
 * frame gets that same ID back. The Agent replays a repeated request ID as the
 * Session it already made, so the two frames open one conversation, never
 * two. Once that Session is deleted the Agent forgets the ID, and the next
 * automatic start makes a new one.
 */
export async function firstSessionRequestId(
  storage: FirstSessionStorage,
  generate: () => string,
): Promise<string> {
  const settled = await storage.claim({
    key: firstSessionStorageKey,
    scope: "member",
    value: { requestId: generate() },
  });
  return decodeClaim(settled.value).requestId;
}
