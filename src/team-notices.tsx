import { ScrollArea } from "@fungi.computer/caps/components/scroll-area";
import type { AppRoot } from "@fungi.computer/agar";
import {
  agentSessionRead,
  agentSessionWrite,
  openAppInbox,
} from "@fungi.computer/agar/agents";
import { readTeamInboxNoticePage } from "@fungi.computer/agar/inbox";
import { queryKeys } from "@fungi.computer/agar/query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Status } from "@fungi.computer/caps/components/status";
import { Button } from "@fungi.computer/caps/components/button";

/** Durable Team notices remain visible independently of Agent/session filters. */
export function TeamNotices({ app }: { app: AppRoot | null }) {
  const [after, setAfter] = useState<string | null>(null);
  const notices = useQuery({
    queryKey: queryKeys.of(app, "team-inbox-notices", after),
    enabled:
      app !== null &&
      (app.capabilities.has(agentSessionRead) ||
        app.capabilities.has(agentSessionWrite)),
    queryFn: async () => {
      if (!app) throw new Error("No App connection");
      const transport = await openAppInbox(app.capabilities);
      try {
        return await readTeamInboxNoticePage(transport, after);
      } finally {
        await transport.close();
      }
    },
  });
  if (!notices.isError && !notices.data?.items.length) return null;
  return (
    <section aria-label="Team notices" className="min-h-0 shrink-0">
      <ScrollArea className="max-h-52 border-b border-base-300">
        {notices.isError ? (
          <p role="alert" className="text-sm">
            Team notices unavailable.
          </p>
        ) : (
          <DataList density="compact" className="px-3 py-2">
            {notices.data.items.map((notice) => (
              <DataRow key={notice.dispositionId}>
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--spacing-xs)]">
                  <Status
                    className="col-span-2 grid grid-cols-subgrid"
                    size="compact"
                    tone="warning"
                    label={
                      "kind" in notice
                        ? "Seller closed"
                        : "Installed App safety notice"
                    }
                  />
                  <p className="m-0 col-start-2 text-sm [overflow-wrap:anywhere]">
                    {"kind" in notice
                      ? `${notice.sellerName} closed. Your installation of ${notice.displayName} continues; no new purchases are available.`
                      : `${notice.displayName} was removed. Fungi will disable it on your Team.`}
                  </p>
                </div>
              </DataRow>
            ))}
          </DataList>
        )}
        {notices.data?.next ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAfter(notices.data.next);
            }}
          >
            Older notices
          </Button>
        ) : null}
        {after !== null ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAfter(null);
            }}
          >
            Newest notices
          </Button>
        ) : null}
      </ScrollArea>
    </section>
  );
}
