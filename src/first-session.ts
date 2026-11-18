import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AppStorageError, type AppStorage } from "@fungi.computer/agar/storage";

/** The member storage key Grove declares for its automatic first Session. */
export const firstSessionStorageKey = "first-session";

const decodeClaim = Schema.decodeUnknownOption(
  Schema.Struct({ requestId: Schema.NonEmptyString }),
);

export type FirstSessionStorage = Pick<AppStorage, "read" | "write">;

/**
 * The one creation request ID for the conversation Grove opens on its own.
 *
 * Grove's window and its chat widget run in separate frames, and each starts
 * a conversation when the member has none listed. Both take their request ID
 * from here: the first to write it to the member's App storage wins, and a
 * frame that loses the compare-and-set reads the winner's. The Agent replays a
 * repeated request ID as the Session it already made, so the two frames open
 * one conversation, never two. Once that Session is deleted the Agent forgets
 * the ID, and the next automatic start makes a new one.
 */
export async function firstSessionRequestId(
  storage: FirstSessionStorage,
  generate: () => string,
): Promise<string> {
  const read = async () => {
    const saved = await storage.read(firstSessionStorageKey);
    const claim = decodeClaim(saved.member?.value);
    return {
      revision: saved.member?.revision ?? null,
      requestId: Option.isSome(claim) ? claim.value.requestId : null,
    };
  };
  const current = await read();
  if (current.requestId !== null) return current.requestId;
  const requestId = generate();
  try {
    await storage.write({
      key: firstSessionStorageKey,
      scope: "member",
      basedOn: current.revision,
      value: { requestId },
    });
    return requestId;
  } catch (cause) {
    if (!(cause instanceof AppStorageError) || cause.code !== "conflict")
      throw cause;
    const winner = await read();
    if (winner.requestId === null) throw cause;
    return winner.requestId;
  }
}
