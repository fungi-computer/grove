import type { AppAgentTransport } from "@fungi.computer/agar/agents";
import type { MemberInboxSession } from "@fungi.computer/agar/inbox";
import * as Schema from "effect/Schema";

const decodeVisit = Schema.decodeUnknownSync(
  Schema.Struct({ agentId: Schema.String, sessionId: Schema.String }),
);

/**
 * A local stand-in for the Hub's member inbox owner. It serves the same page,
 * Server-Sent Events and visit routes, and pushes a delta for each change.
 * Grove's production feed client and inbox run unchanged against it.
 */
export function createFixtureMemberInbox(
  initial: readonly MemberInboxSession[],
  options: Readonly<{ failFirstRead?: boolean }> = {},
) {
  const items = new Map<string, MemberInboxSession>(
    initial.map((item) => [`${item.agentId}\u0000${item.sessionId}`, item]),
  );
  let cursor = 0;
  let failNextRead = options.failFirstRead === true;
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();

  const push = (changed: readonly MemberInboxSession[]) => {
    const from = cursor;
    for (const item of changed)
      items.set(`${item.agentId}\u0000${item.sessionId}`, item);
    cursor += changed.length;
    const event = `id: ${String(cursor)}\nevent: rows\ndata: ${JSON.stringify({ kind: "rows", from, to: cursor, items: changed, more: false })}\n\n`;
    for (const stream of streams) stream.enqueue(encoder.encode(event));
  };

  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/inbox/notices"))
      return Promise.resolve(Response.json({ items: [], next: null }));
    if (url.pathname.endsWith("/inbox")) {
      if (failNextRead) {
        failNextRead = false;
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      return Promise.resolve(
        Response.json({ items: [...items.values()], next: null, cursor }),
      );
    }
    if (url.pathname.endsWith("/inbox/events")) {
      let owned: ReadableStreamDefaultController<Uint8Array> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          owned = controller;
          streams.add(controller);
          controller.enqueue(encoder.encode(": inbox\n\n"));
        },
        cancel() {
          if (owned) streams.delete(owned);
        },
      });
      request.signal.addEventListener("abort", () => {
        if (owned) streams.delete(owned);
      });
      return Promise.resolve(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }
    if (url.pathname.endsWith("/inbox/visits"))
      return request
        .json()
        .then(decodeVisit)
        .then((body) => {
          const item = items.get(`${body.agentId}\u0000${body.sessionId}`);
          if (item === undefined || item.state === "unavailable")
            return new Response(null, { status: 404 });
          push([{ ...item, visitedAt: Date.now() }]);
          return new Response(null, { status: 204 });
        });
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const transport: AppAgentTransport = {
    baseUrl: "https://grove-preview.invalid/member",
    fetch,
    close: () => Promise.resolve(),
  };
  return {
    transport,
    push,
    skipDelta: () => {
      cursor += 1;
    },
    failReadOnce: () => {
      failNextRead = true;
    },
    reset: () => {
      for (const stream of streams)
        stream.enqueue(encoder.encode("event: reset\ndata: {}\n\n"));
    },
    disconnect: () => {
      for (const stream of streams) stream.close();
      streams.clear();
    },
    remove: (agentId: string, sessionId: string) => {
      items.delete(`${agentId}\u0000${sessionId}`);
    },
    current: (agentId: string, sessionId: string) =>
      items.get(`${agentId}\u0000${sessionId}`),
  };
}
