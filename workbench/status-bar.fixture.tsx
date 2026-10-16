import type {
  AppRoot,
  AppStatusActionHandler,
  AppStatusItem,
} from "@fungi.computer/agar";
import { AppStatusBar } from "@fungi.computer/caps/blocks/app-status-bar";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { CountBadge } from "@fungi.computer/caps/components/count-badge";
import { useState } from "react";

/** The workbench host draws Grove's declared footer keys outside the App. */
export function useWorkbenchStatusBar() {
  const [items, setItems] = useState<readonly AppStatusItem[]>([]);
  const [channel] = useState(() => {
    let handler: AppStatusActionHandler | undefined;
    const status: Pick<AppRoot["ui"], "reportStatus" | "onStatusAction"> = {
      reportStatus: (next) => {
        setItems(next);
        return Promise.resolve();
      },
      onStatusAction: (next) => {
        handler = next;
        return () => {
          if (handler === next) handler = undefined;
        };
      },
    };
    return { status, act: (itemId: string) => handler?.({ itemId }) };
  });
  const bar =
    items.length === 0 ? null : (
      <AppStatusBar aria-label="Grove status">
        {items.map((item) => {
          if (item.kind !== "button")
            throw new Error("Grove's fixture expects declared footer buttons");
          return (
            <KeycapButton
              key={item.id}
              label={item.text}
              expanded={item.expanded}
              disabled={item.disabled}
              title={item.title}
              aria-haspopup={item.opens}
              readout={
                item.count !== undefined && item.count > 0 ? (
                  <CountBadge count={item.count} />
                ) : undefined
              }
              onClick={() => {
                void channel.act(item.id);
              }}
            />
          );
        })}
      </AppStatusBar>
    );
  return { status: channel.status, bar };
}
