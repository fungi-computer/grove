import type { AppRoot } from "@fungi.computer/agar";
import { openAppAgent } from "@fungi.computer/agar/agents";
import { seedSessionQuery } from "@fungi.computer/parakeet/headless";
import type { QueryClient } from "@tanstack/react-query";
import {
  createShiitakeClient,
  type ShiitakeAgent,
  type ShiitakeEventSourceConstructor,
  type ShiitakeSession,
} from "@fungi.computer/shiitake/client";
import { ShiitakeError } from "@fungi.computer/shiitake";
import {
  EventSource as EventSourceImplementation,
  type EventSourceFetchInit,
} from "eventsource";

export type OpenConversation = Readonly<{
  agentId: string;
  sessionId: string;
  session: ShiitakeSession;
}>;

export type PendingSelection = Readonly<{
  agentId: string;
  sessionId: string;
}>;

export type InboxClient = Pick<
  ShiitakeAgent,
  "createSession" | "deleteSession" | "session" | "close"
>;
type Opening = PendingSelection & { close: () => void };

export type Services = Readonly<{
  openAgent: typeof openAppAgent;
  createClient: (
    options: Parameters<typeof createShiitakeClient>[0],
  ) => InboxClient;
}>;

/** Seed Parakeet's shared query with the bounded read before mounting its watch. */
function prepareConversation(
  queryClient: QueryClient,
  session: ShiitakeSession,
) {
  let cancelled = false;
  const readBaseline = async () => {
    try {
      return await session.read();
    } catch (cause) {
      if (
        !(cause instanceof ShiitakeError) ||
        cause.boundary !== "runtime" ||
        cause.cause !== "unavailable"
      )
        throw cause;
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      if (cancelled)
        throw new Error("Conversation opening cancelled", { cause });
      return session.read();
    }
  };
  let cancel!: () => void;
  const cancelledRead = new Promise<never>((_, reject) => {
    cancel = () => {
      reject(new Error("Conversation opening cancelled"));
    };
  });
  const ready = Promise.race([readBaseline(), cancelledRead]).then(
    (snapshot) => {
      if (cancelled) throw new Error("Conversation opening cancelled");
      seedSessionQuery(queryClient, session, snapshot);
    },
  );
  return {
    ready,
    close: () => {
      cancelled = true;
      cancel();
    },
  };
}

export function eventSourceFor(
  fetcher: typeof globalThis.fetch,
): ShiitakeEventSourceConstructor {
  return class HostEventSource {
    readonly #source: InstanceType<typeof EventSourceImplementation>;

    constructor(url: string) {
      this.#source = new EventSourceImplementation(url, {
        fetch: (input: string | URL, init: EventSourceFetchInit) =>
          fetcher(input, init),
      });
    }

    get readyState(): number {
      return this.#source.readyState;
    }

    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void {
      this.#source.addEventListener(type, listener, options);
    }

    close(): void {
      this.#source.close();
    }
  };
}

/** Owns the selected conversation's Agent, client and Parakeet query lifetimes. */
export function createConversationOpeningOwner(
  options: Readonly<{
    connection: AppRoot;
    queryClient: QueryClient;
    services: Services;
    onPending: (selection: PendingSelection | null) => void;
    onConversation: (conversation: OpenConversation | null) => void;
    onError: (message: string | null) => void;
    /** Only the primary conversation is the selection the host shell sees. */
    reportsSelection?: boolean;
  }>,
) {
  const { connection, queryClient, services } = options;
  let pending: Opening | null = null;
  let current: OpenConversation | null = null;
  let currentClose: (() => void) | null = null;
  let disposed = false;

  const same = (left: PendingSelection | null, right: PendingSelection) =>
    left?.agentId === right.agentId && left.sessionId === right.sessionId;
  const isCurrent = (opening: Opening) => !disposed && pending === opening;

  const select = (
    agentId: string,
    sessionId: string,
    fromOpenRequest = false,
    waitForBaseline = true,
  ) => {
    if (disposed) return;
    const selection = { agentId, sessionId };
    if (same(pending, selection)) return;
    pending?.close();
    pending = null;
    options.onPending(null);
    options.onError(null);
    if (same(current, selection)) return;

    let openedClose: (() => void) | null = null;
    let closed = false;
    const opening: Opening = {
      ...selection,
      close: () => {
        if (closed) return;
        closed = true;
        openedClose?.();
      },
    };
    pending = opening;
    options.onPending(selection);

    void (async () => {
      try {
        const transport = await services.openAgent(connection.capabilities, {
          agentId,
        });
        if (!isCurrent(opening)) {
          await transport.close();
          return;
        }
        const client = services.createClient({
          baseUrl: transport.baseUrl,
          eventSource: eventSourceFor(transport.fetch),
          fetch: transport.fetch,
        });
        const session = client.session(sessionId);
        const observation = prepareConversation(queryClient, session);
        openedClose = () => {
          observation.close();
          void Promise.allSettled([client.close(), transport.close()]);
        };
        await observation.ready;
        if (waitForBaseline && options.reportsSelection !== false) {
          await connection.ui.reportAgentSessionSelection({
            agentId,
            sessionId,
          });
        }
        if (!isCurrent(opening)) return;

        const conversation = { agentId, sessionId, session };
        const previousClose = currentClose;
        pending = null;
        current = conversation;
        currentClose = opening.close;
        options.onConversation(conversation);
        options.onPending(null);
        previousClose?.();
      } catch (cause: unknown) {
        console.error("Chat Session opening failed", cause);
        opening.close();
        if (isCurrent(opening)) {
          pending = null;
          options.onPending(null);
          options.onError(
            fromOpenRequest
              ? `That Session could not be opened. ${current ? "The current conversation remains open." : "Choose another Session from the list."}`
              : `Could not open this Session${cause instanceof Error ? `: ${cause.message}` : ""}. ${current ? "The previous conversation remains open." : "Try opening it again."}`,
          );
        }
      }
    })();
  };

  const clear = () => {
    if (disposed) return;
    const hadSelection = pending !== null || current !== null;
    pending?.close();
    pending = null;
    currentClose?.();
    currentClose = null;
    current = null;
    options.onPending(null);
    options.onConversation(null);
    options.onError(null);
    if (!hadSelection || options.reportsSelection === false) return;
    void connection.ui
      .reportAgentSessionSelection(null)
      .catch((cause: unknown) => {
        console.error("Chat Session selection could not be reported", cause);
        return undefined;
      });
  };

  const close = () => {
    clear();
    disposed = true;
  };

  return { select, clear, close };
}
