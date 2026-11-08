import { messageAuthor } from "@fungi.computer/agar/agents";
import goalClient from "@fungi.computer/shiitake-extensions/goal/client";
import loopClient from "@fungi.computer/shiitake-extensions/loop/client";
import planClient from "@fungi.computer/shiitake-extensions/plan/client";
import questionClient from "@fungi.computer/shiitake-extensions/question/client";
import subagentsClient from "@fungi.computer/shiitake-extensions/subagents/client";

import {
  ParakeetProvider,
  ParakeetView,
  useComposer,
  type ParakeetSession,
  type ParakeetToolItem,
} from "@fungi.computer/parakeet";
import type { AppRoot, SetupState } from "@fungi.computer/agar";
import type { RowV1 } from "@fungi.computer/gills";
import { openAdmissionLink } from "./admission-link.js";
import { showConversationToast } from "./conversation-toast.js";
import type {
  ParakeetCommandRuntime,
  ParakeetToast,
  ParakeetDraftIdentity,
} from "@fungi.computer/parakeet/headless";
import { FileResultAction } from "./file-result-action.js";
import { claimsPrintsPanel, ImageResultCard } from "./image-result-card.js";
import { ApprovalRow } from "./approval-card.js";
import { ApprovalOwners, pendingApprovalId } from "./approval-owners.js";
import { GameShareCard, gameShareDisplayText } from "./game-share-card.js";
import "@fungi.computer/stipe/fonts-mono.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { starterPrompts } from "./starters.js";

// The same Session footer entries the TUI mounts (apps/tui/src/cli.tsx).
const sessionClients = [
  goalClient,
  loopClient,
  planClient,
  questionClient,
  subagentsClient,
];

const renderAssistantAttachment = (reply: string) => (
  <GameShareCard reply={reply} />
);

function ComposeDraft({
  prefill,
  onPrefilled,
}: {
  prefill: Readonly<{
    requestId: string;
    text: string;
    /** A chosen starter sends as written, the way a chip does in an empty chat. */
    send?: boolean;
  }> | null;
  onPrefilled: () => void;
}) {
  const composer = useComposer();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!prefill || handled.current === prefill.requestId) return;
    handled.current = prefill.requestId;
    composer.setDraft(prefill.text);
    if (prefill.send === true) composer.send();
    onPrefilled();
  }, [composer.setDraft, composer.send, onPrefilled, prefill]);
  return null;
}

export function ParakeetConversation({
  session,
  draftIdentity,
  connection,
  commands,
  prefill = null,
  onPrefilled = () => undefined,
  onOpen,
  models,
  autoFocus,
}: {
  session: ParakeetSession;
  draftIdentity: ParakeetDraftIdentity;
  connection: AppRoot | null;
  commands: ParakeetCommandRuntime;
  prefill?: Readonly<{
    requestId: string;
    text: string;
    send?: boolean;
  }> | null;
  onPrefilled?: () => void;
  /** Open a footer row's conversation; Grove shows it beside this one. */
  onOpen?: ((target: NonNullable<RowV1["open"]>) => void) | undefined;
  /** Whether the host has a model connected; absent when it does not say. */
  models?: SetupState | undefined;
  /** Focus the composer on open, so the person can just type. */
  autoFocus?: boolean | undefined;
}): React.JSX.Element {
  const ui = connection?.ui ?? null;
  const capabilities = connection?.capabilities;
  // What the host knows, so the conversation can speak plainly before a run fails.
  const hostFacts = useMemo(
    () => ({
      modelSetup:
        models === undefined
          ? undefined
          : {
              state: models,
              fix: {
                label: "Add a model key",
                onSelect: () => {
                  void ui?.openSetup("model").catch((cause: unknown) => {
                    console.error("Grove could not open model setup", cause);
                  });
                },
              },
            },
      starters: starterPrompts,
    }),
    [models, ui],
  );
  const onLink = useCallback(
    (href: string) => openAdmissionLink(ui, href),
    [ui],
  );
  const renderToolActions = useCallback(
    (item: ParakeetToolItem) => {
      const recordId = pendingApprovalId(item);
      if (recordId !== undefined && capabilities !== undefined)
        return <ApprovalRow key={recordId} recordId={recordId} />;
      return ui ? (
        <>
          <FileResultAction item={item} ui={ui} />
          <ImageResultCard item={item} capabilities={capabilities} />
        </>
      ) : null;
    },
    [ui, capabilities],
  );
  const claimsToolMedia = useCallback(
    (item: ParakeetToolItem) =>
      capabilities !== undefined && claimsPrintsPanel(item),
    [capabilities],
  );
  const onToast = useCallback(
    (toast: ParakeetToast) => {
      showConversationToast(ui, toast);
    },
    [ui],
  );
  return (
    <ParakeetProvider
      session={session}
      draftIdentity={draftIdentity}
      clients={sessionClients}
      authorOf={messageAuthor}
      onToast={onToast}
    >
      <ComposeDraft prefill={prefill} onPrefilled={onPrefilled} />
      <ApprovalOwners
        capabilities={capabilities}
        agentId={draftIdentity.agentId}
      >
        <ParakeetView
          onLink={onLink}
          onOpen={onOpen}
          hostFacts={hostFacts}
          autoFocus={autoFocus}
          composerActionVariant="outline"
          commands={commands}
          renderAssistantAttachment={renderAssistantAttachment}
          formatAssistantText={gameShareDisplayText}
          renderToolActions={renderToolActions}
          claimsToolMedia={claimsToolMedia}
        />
      </ApprovalOwners>
    </ParakeetProvider>
  );
}
