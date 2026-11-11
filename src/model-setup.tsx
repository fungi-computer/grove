import { useState } from "react";
import type { AppRoot } from "@fungi.computer/agar";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import { ShiitakeAvatar } from "@fungi.computer/parakeet";

const steps = [
  {
    title: "Add your key",
    detail: "Choose your provider in Model keys. Your key stays private.",
  },
  {
    title: "Come back and ask",
    detail:
      "Close Settings to return here. Start with a question or a short writing task.",
  },
  {
    title: "Pick up where you left off",
    detail: "Find your conversations in Grove and your desktop Inbox.",
  },
] as const;

/** The first conversation's purpose, prerequisite and real path back to Grove. */
export function ModelSetup({ connection }: { connection: AppRoot }) {
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setFailed(false);
    setOpening(true);
    try {
      setFailed((await connection.ui.openSetup("model")) !== "opened");
    } catch (cause: unknown) {
      console.error("Grove could not open model setup", cause);
      setFailed(true);
    } finally {
      setOpening(false);
    }
  };
  return (
    <section
      className="inbox-empty @container m-auto flex w-full max-w-3xl flex-col gap-xl overflow-y-auto px-lg py-xl"
      aria-label="Get started with Grove"
    >
      <EmptyState
        variant="panel"
        title="Connect a model to start chatting"
        description="An Agent is an AI helper that writes, thinks through ideas and works with your Apps. A model powers its replies: connect Cloudflare Workers AI, or bring a key from your own model provider."
        visual={
          <span className="block" style={{ width: "3.5rem", height: "3.5rem" }}>
            <ShiitakeAvatar
              className="h-full w-full"
              state={{ activity: "idle", expression: "normal" }}
            />
          </span>
        }
        primaryAction={{
          label: opening ? "Opening Model keys…" : "Add a model key",
          onSelect: () => void open(),
          pending: opening,
        }}
      />
      {failed ? (
        <FailureLine
          role="alert"
          message="Model keys could not open. Try opening them again."
          onRetry={() => void open()}
          onDismiss={() => {
            setFailed(false);
          }}
        />
      ) : null}
      <ol className="m-0 grid list-none gap-lg p-0 text-sm @xl:grid-cols-3">
        {steps.map((step, index) => (
          <li
            className="flex flex-col gap-xs border-t border-base-300 pt-md"
            key={step.title}
          >
            <strong className="font-semibold">
              {String(index + 1)}. {step.title}
            </strong>
            <span className="text-(--stipe-fg-muted)">{step.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
