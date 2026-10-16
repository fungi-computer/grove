import * as z from "zod";
import * as Schema from "effect/Schema";
import {
  appSendBudgetRefusalSchema,
  defineAppBackend,
  defineAppMethod,
} from "@fungi.computer/agar/backend-definition";
import {
  memberInboxItemSchema,
  inboxVisitResultSchema,
} from "@fungi.computer/agar/inbox";
import { inboxGill } from "./inbox-gill.js";
import type { WhistleJsonValue } from "@fungi.computer/whistle";

export type GroveMethodContext = Readonly<{
  env: Readonly<{
    INBOX?: Readonly<{
      page(input: { after: string | null }): Promise<WhistleJsonValue>;
      visit(input: {
        agentId: string;
        sessionId: string;
      }): Promise<WhistleJsonValue>;
    }>;
    AGENTS?: Readonly<{
      send(input: {
        agentId: string;
        sessionId: string;
        text: string;
        delivery: "followUp";
      }): Promise<WhistleJsonValue>;
    }>;
  }>;
}>;
const id = z.string().min(1).max(256);
const pageInput = z.strictObject({
  limit: z.literal(200).optional(),
  after: z.string().min(1).max(1024).nullable().optional(),
});
const target = z.strictObject({ agentId: id, sessionId: id });
const item = z.fromJSONSchema(
  Schema.toJsonSchemaDocument(memberInboxItemSchema).schema,
);
const pageOutput = z.strictObject({
  items: z.array(item).max(200),
  next: z.string().nullable(),
  cursor: z.number().int().nonnegative(),
});
const readPage = async (
  input: z.output<typeof pageInput>,
  context: GroveMethodContext,
) => {
  if (!context.env.INBOX) throw new Error("Inbox access is not granted");
  return pageOutput.parse(
    await context.env.INBOX.page({ after: input.after ?? null }),
  );
};
const sendOutput = z.union([
  z.strictObject({ status: z.literal("accepted"), commandId: id }),
  appSendBudgetRefusalSchema,
]);
export const appBackend = defineAppBackend<GroveMethodContext>({
  gills: [inboxGill],
  methods: {
    listSessions: defineAppMethod({
      description:
        "List existing visible Sessions for an Agent, with a continuation cursor.",
      effect: "read",
      requires: ["agent.read"],
      input: pageInput.extend({ agentId: id }),
      output: pageOutput,
      handler: async (input, context) => {
        const page = await readPage(input, context);
        return {
          ...page,
          items: page.items.filter((row) => {
            const item = Schema.decodeUnknownSync(memberInboxItemSchema)(row);
            return !("kind" in item) && item.agentId === input.agentId;
          }),
        };
      },
    }),
    listInbox: defineAppMethod({
      description: "Read a page of the admitted member Inbox.",
      effect: "read",
      requires: ["agent.read"],
      input: pageInput,
      output: pageOutput,
      handler: readPage,
    }),
    openInboxItem: defineAppMethod({
      description:
        "Mark an existing visible Inbox Session as visited and return its target.",
      effect: "write",
      requires: ["agent.read"],
      input: target,
      output: target.extend(inboxVisitResultSchema.shape),
      handler: async (input, context) => {
        if (!context.env.INBOX) throw new Error("Inbox access is not granted");
        const visit = inboxVisitResultSchema.parse(
          await context.env.INBOX.visit(input),
        );
        return { ...input, ...visit };
      },
    }),
    sendMessage: defineAppMethod({
      description:
        "Send follow-up text into an existing authorized Session without interrupting it. Limited to ten sends per minute per installation and Session; returns send_budget_exceeded with retryAfterMs when full. This does not create a Session.",
      effect: "write",
      requires: ["agent.send"],
      input: target.extend({
        text: z
          .string()
          .min(1)
          .max(192 * 1024),
      }),
      output: sendOutput,
      handler: async (input, context) => {
        if (!context.env.AGENTS)
          throw new Error("Agent send access is not granted");
        return sendOutput.parse(
          await context.env.AGENTS.send({ ...input, delivery: "followUp" }),
        );
      },
    }),
  },
});
