import { useState } from "react";
import type { AppRoot } from "@fungi.computer/agar";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { SetupNotice } from "@fungi.computer/caps/blocks/setup-notice";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import { ShiitakeAvatar } from "@fungi.computer/parakeet";

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
      className="inbox-empty mx-auto flex w-full max-w-3xl flex-col gap-lg overflow-y-auto px-lg py-xl sm:py-3xl"
      aria-label="Get started with Grove"
    >
      <EmptyState
        variant="plain"
        title="Make something together"
        description="An Agent is an AI helper. Chat in Grove to write, think through ideas, and work with your Apps."
        visual={
          <ShiitakeAvatar
            className="size-20"
            state={{ activity: "idle", expression: "normal" }}
          />
        }
      />
      <SetupNotice
        need="Connect a model to start chatting"
        cause="A model powers your Agent’s replies. Bring a key from Anthropic, OpenAI or OpenRouter."
        fix={{
          label: opening ? "Opening Model keys…" : "Add a model key",
          onSelect: () => void open(),
          pending: opening,
        }}
        waitingFor="Model keys"
        variant="inline"
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
      <ol className="m-0 grid list-none gap-lg p-0 text-sm sm:grid-cols-3">
        <li className="flex flex-col gap-xs">
          <strong className="font-semibold">1. Add your key</strong>
          <span className="text-(--stipe-fg-muted)">
            Choose your provider in Model keys. Your key stays private.
          </span>
        </li>
        <li className="flex flex-col gap-xs">
          <strong className="font-semibold">2. Come back and ask</strong>
          <span className="text-(--stipe-fg-muted)">
            Close Settings to return here. Start with a question or a short
            writing task.
          </span>
        </li>
        <li className="flex flex-col gap-xs">
          <strong className="font-semibold">
            3. Pick up where you left off
          </strong>
          <span className="text-(--stipe-fg-muted)">
            Find your conversations in Grove and your desktop Inbox.
          </span>
        </li>
      </ol>
    </section>
  );
}
