import type { RowV1, GillResponse } from "@fungi.computer/gills";
import * as Schema from "effect/Schema";
import { defineAppGill } from "@fungi.computer/agar/gills";
import {
  memberInboxItemSchema,
  memberInboxKey,
} from "@fungi.computer/agar/inbox";
import { buildInboxSessionView, inboxStatusCopy } from "../src/inbox-model.js";

const page = Schema.Struct({
  items: Schema.Array(memberInboxItemSchema).check(Schema.isMaxLength(200)),
  next: Schema.NullOr(Schema.String),
  cursor: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
const stateTones = {
  needs_you: "warning",
  running: "info",
  errored: "error",
  done: "success",
} as const;

/** The ordinary listInbox method supplies this projection in the same read frame. */
export const inboxGill = defineAppGill({
  id: "inbox",
  title: "Inbox",
  source: "listInbox",
  limit: 200,
  sizes: ["S", "M", "L"],
  watch: { binding: "INBOX" },
  input: ({ after, limit }) => ({ limit, after: after ?? null }),
  rows: (output): GillResponse => {
    const data = Schema.decodeUnknownSync(page, { onExcessProperty: "error" })(
      output,
    );
    const view = buildInboxSessionView(data.items);
    if (
      view.active.length === 0 &&
      view.settled.length === 0 &&
      view.unavailable.length > 0
    )
      return {
        viewId: "inbox",
        title: "Inbox",
        state: "error",
        rows: [],
        error:
          "Saved conversations couldn't be read. Open Grove to check access and refresh.",
        recovery: { kind: "open" },
      };
    const rows: RowV1[] = [...view.active, ...view.settled].map((item) => {
      const row: RowV1 = {
        id: memberInboxKey(item.agentId, item.sessionId),
        title: item.title || "Untitled session",
        status: {
          label: inboxStatusCopy[item.state],
          tone: stateTones[item.state],
        },
        open: {
          params: [
            { key: "agent", value: item.agentId },
            { key: "session", value: item.sessionId },
          ],
        },
      };
      return item.unseen ? { ...row, detail: "Unseen" } : row;
    });
    for (const item of view.unavailable)
      rows.push({
        id: memberInboxKey(item.agentId, item.sessionId),
        title: "Conversation unavailable",
        detail: "This saved conversation could not be read",
        status: { label: "Unavailable", tone: "warning" },
      });
    const continuation = data.next === null ? {} : { next: data.next };
    return rows.length === 0
      ? {
          viewId: "inbox",
          title: "Inbox",
          state: "empty",
          rows: [],
          ...continuation,
        }
      : {
          viewId: "inbox",
          title: "Inbox",
          state: "full",
          rows,
          ...continuation,
        };
  },
});
