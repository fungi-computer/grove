import type { ReactNode } from "react";
import type { AppAgent } from "@fungi.computer/agar/agents";
import { Button } from "@fungi.computer/caps/components/button";
import { ScrollArea } from "@fungi.computer/caps/components/scroll-area";
import { AgentHead, type AgentHeadActivity } from "@fungi.computer/parakeet";
import { Sigil } from "@fungi.computer/sigils";
import { Plus } from "lucide-react";
import { useState } from "react";
import { agentLabel } from "./inbox-model.js";

function RailMark({ children }: { children: ReactNode }) {
  return (
    <span className="grove-rail-mark grid size-full place-items-center">
      {children}
    </span>
  );
}

/** The retained square rail. */
export function AgentRail({
  open,
  agents,
  agentActivity,
  agentFilterId,
  websitesSelected,
  websitesVisible,
  canCreate,
  createOpen,
  onAll,
  onWebsites,
  onAgent,
  onCreate,
}: {
  open: boolean;
  agents: readonly AppAgent[];
  /** Agents with a Session waiting on you or working; others are at rest. */
  agentActivity: ReadonlyMap<string, AgentHeadActivity>;
  agentFilterId: string | null;
  websitesSelected: boolean;
  websitesVisible: boolean;
  canCreate: boolean;
  createOpen: boolean;
  onAll: () => void;
  onWebsites: () => void;
  onAgent: (agentId: string) => void;
  onCreate: () => void;
}) {
  const [attended, setAttended] = useState<string | null>(null);
  const cell = "grove-rail-cell relative size-12 rounded-field p-0";
  const allSelected =
    agentFilterId === null && !(websitesSelected && websitesVisible);
  return (
    <nav
      id="grove-agent-rail"
      aria-label="Agents"
      className={`grove-rail min-h-0 w-16 flex-none flex-col items-center gap-1 border-r border-base-300 py-2 ${open ? "flex" : "flex min-[900px]:hidden"}`}
    >
      <Button
        variant="ghost"
        aria-label="All Agents"
        aria-pressed={allSelected}
        className={`${cell} text-xs ${allSelected ? "bg-base-300" : ""}`}
        onClick={onAll}
      >
        <RailMark>All</RailMark>
      </Button>
      {websitesVisible ? (
        <Button
          variant="ghost"
          aria-label="Websites"
          aria-pressed={websitesSelected}
          className={`${cell} ${websitesSelected ? "bg-base-300" : ""}`}
          onClick={onWebsites}
        >
          <RailMark>
            <Sigil name="internet" size={28} />
          </RailMark>
        </Button>
      ) : null}
      <ScrollArea className="w-full flex-1" style={{ width: "100%" }}>
        <div className="flex flex-col items-center gap-1 py-1">
          {agents.map((agent) => (
            <Button
              key={agent.agentId}
              variant="ghost"
              aria-label={agentLabel(agent)}
              title={agentLabel(agent)}
              aria-pressed={
                agentFilterId === agent.agentId && !websitesSelected
              }
              data-agent-id={agent.agentId}
              className={`${cell} ${agentFilterId === agent.agentId && !websitesSelected ? "bg-base-300" : ""}`}
              onPointerEnter={() => {
                setAttended(agent.agentId);
              }}
              onPointerLeave={() => {
                setAttended(null);
              }}
              onFocus={() => {
                setAttended(agent.agentId);
              }}
              onBlur={() => {
                setAttended(null);
              }}
              onClick={() => {
                onAgent(agent.agentId);
              }}
            >
              <RailMark>
                <AgentHead
                  activity={
                    agentActivity.get(agent.agentId) ??
                    (attended === agent.agentId ? "thinking" : "idle")
                  }
                  avatar={agent.avatar}
                  name={agentLabel(agent)}
                  size={32}
                />
              </RailMark>
            </Button>
          ))}
        </div>
      </ScrollArea>
      {canCreate ? (
        <Button
          variant="ghost"
          aria-label="New Agent"
          aria-expanded={createOpen}
          aria-haspopup="dialog"
          className={`${cell} mt-auto`}
          onClick={onCreate}
        >
          <span className="grove-rail-mark grid size-full place-items-center">
            <Plus size={20} />
          </span>
        </Button>
      ) : null}
    </nav>
  );
}
