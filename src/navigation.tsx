import { createContext, useCallback, useContext, type ReactNode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useMatch,
  useRouterState,
  useCanGoBack,
} from "@tanstack/react-router";
import { useHostNavigation } from "@fungi.computer/agar/react";
import type { HostNavigation } from "@fungi.computer/agar";
import { z } from "zod";

const renderInbox = createContext<ReactNode>(null);
export const InboxRouteContent = renderInbox.Provider;
const root = createRootRoute({
  validateSearch: z.object({ agent: z.string().min(1).optional() }),
  component: () => null,
});
const list = createRoute({ getParentRoute: () => root, path: "/" });
const sessionParams = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
});
const session = createRoute({
  getParentRoute: () => root,
  path: "/sessions/$agentId/$sessionId",
  params: { parse: (params) => sessionParams.parse(params) },
});

/** The App window owns memory history; browser/Hub history stays with the host. */
export function createInboxRouter() {
  return createRouter({
    routeTree: root.addChildren([list, session]),
    history: createMemoryHistory(),
    InnerWrap: ({ children }) => (
      <>
        {useContext(renderInbox)}
        {children}
      </>
    ),
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
}
export type InboxRouter = ReturnType<typeof createInboxRouter>;

/** The conversation the router shows now, read once a navigation has finished. */
export function shownSelection(
  router: InboxRouter,
): { agentId: string; sessionId: string } | null {
  const match = router.state.matches.find(
    (entry) => entry.routeId === session.id,
  );
  const parsed = sessionParams.safeParse(match?.params);
  return parsed.success ? parsed.data : null;
}

export function useInboxNavigation(
  router: InboxRouter,
  host: HostNavigation | undefined,
) {
  const search = useRouterState({
    router,
    select: (state) => state.location.search,
  });
  const match = useMatch<InboxRouter, typeof session.id, true, false>({
    from: session.id,
    shouldThrow: false,
  });
  const canGoBack = useCanGoBack();
  useHostNavigation(host, {
    canGoBack,
    canGoForward: false,
    onForward: () => false,
    onBack: () => {
      if (!router.history.canGoBack()) return false;
      router.history.back();
      return true;
    },
  });
  const setFilter = useCallback(
    (agent: string | null) => {
      void router.navigate({
        to: ".",
        search: { agent: agent ?? undefined },
        replace: true,
      });
    },
    [router],
  );
  const open = useCallback(
    (agentId: string, sessionId: string) =>
      router.navigate({
        to: "/sessions/$agentId/$sessionId",
        params: { agentId, sessionId },
        search: true,
      }),
    [router],
  );
  return {
    agentFilterId: search.agent ?? null,
    setFilter,
    selection: match?.params,
    open,
  };
}
