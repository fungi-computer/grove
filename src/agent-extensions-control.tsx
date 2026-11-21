import type {
  AppAgentExtension,
  AppAgentExtensions,
} from "@fungi.computer/agar";
import { Button } from "@fungi.computer/caps/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@fungi.computer/caps/components/tooltip";
import { Puzzle } from "lucide-react";
import { useState } from "react";

/** One change the owner asks of an Agent's extensions. */
export type ExtensionChange = Readonly<{
  kind: "attach" | "detach";
  installationId: string;
}>;

/**
 * Owner-only list of the hosted extensions on one Agent: the installed Apps
 * that add their prompt and tools to its runs. Attaching is the owner's
 * consent; an Agent's blanket App-tool approval never asks an extension. The
 * host says what is attached now, so a lapsed attachment shows as available.
 * A refused change is the caller's to put in a toast.
 */
export function AgentExtensionsControl({
  agentId,
  name,
  extensions,
  loading,
  change,
}: {
  agentId: string;
  name: string;
  /** What the host last read; absent until it has been read. */
  extensions: AppAgentExtensions | undefined;
  loading: boolean;
  /** Attach or detach one installation; resolves once the host has answered. */
  change: (change: ExtensionChange) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  // The installation whose change is in flight: one tap is one request.
  const [busy, setBusy] = useState<string | null>(null);
  const run = (next: ExtensionChange) => {
    if (busy !== null) return;
    setBusy(next.installationId);
    void change(next).finally(() => {
      setBusy(null);
    });
  };
  const row = (item: AppAgentExtension, kind: ExtensionChange["kind"]) => {
    const verb = kind === "attach" ? "Attach" : "Detach";
    return (
      <li
        key={item.installationId}
        data-extension-row=""
        className="flex h-8 items-center justify-between gap-2"
      >
        <span className="min-w-0 truncate text-sm">{item.name}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          // Detach only removes authority, so it reads quieter than Attach.
          className={`flex-none ${kind === "detach" ? "text-base-content/70" : ""}`}

          aria-label={`${verb} ${item.name}`}
          disabled={busy !== null}
          loading={busy === item.installationId}
          onClick={() => {
            run({ kind, installationId: item.installationId });
          }}
        >
          {verb}
        </Button>
      </li>
    );
  };
  const none =
    extensions?.attached.length === 0 && extensions.available.length === 0;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            aria-label="Extensions"
            aria-haspopup="dialog"
            icon={<Puzzle size={14} aria-hidden="true" />}
            disabled={loading || extensions === undefined}
            onClick={() => {
              setOpen(true);
            }}
          />
        </TooltipTrigger>
        <TooltipContent>Extensions</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex flex-col gap-lg"
          keepMounted={false}
          forceBackdrop
        >
          <DialogHeader>
            <DialogTitle>{name}'s extensions</DialogTitle>
            <DialogDescription>
              An extension is an installed App that adds its own instructions
              and tools to {name}'s conversations. Only you can attach one.
            </DialogDescription>
          </DialogHeader>
          {none ? (
            <p className="text-sm text-base-content/70">
              No installed App is an Agent extension yet.
            </p>
          ) : (
            <div className="grid gap-md" data-agent={agentId}>
              {extensions !== undefined && extensions.attached.length > 0 ? (
                <section aria-label="Attached" className="grid gap-xs">
                  <h3 className="m-0 text-xs font-medium text-base-content/70">
                    Attached
                  </h3>
                  <ul className="m-0 grid list-none gap-0 p-0">
                    {extensions.attached.map((item) => row(item, "detach"))}
                  </ul>
                </section>
              ) : null}
              {extensions !== undefined && extensions.available.length > 0 ? (
                <section aria-label="Available" className="grid gap-xs">
                  <h3 className="m-0 text-xs font-medium text-base-content/70">
                    Available
                  </h3>
                  <ul className="m-0 grid list-none gap-0 p-0">
                    {extensions.available.map((item) => row(item, "attach"))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
