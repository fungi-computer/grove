import almanacClient from "@fungi.computer/shiitake-extensions/almanac/client";
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
import { ApprovalOwners } from "./approval-owners.js";
import { GameShareCard, gameShareDisplayText } from "./game-share-card.js";
import "@fungi.computer/stipe/fonts-mono.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDraftMirror } from "./draft-mirror-provider.js";

// The same Session footer entries the TUI mounts (apps/tui/src/cli.tsx).
const sessionClients = [
  goalClient,
  loopClient,
  almanacClient,
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
  identity,
  children,
}: {
  identity: ParakeetDraftIdentity;
  children: ReactNode;
  prefill: Readonly<{
    requestId: string;
    text: string;
  }> | null;
  onPrefilled: () => void;
}) {
  const composer = useComposer();
  const mirror = useDraftMirror();
  const [seed, setSeed] = useState<{ mirror: typeof mirror } | null>(null);
  const seeded = seed !== null && seed.mirror === mirror;
  const handled = useRef<string | null>(null);
  const { agentId, sessionId } = identity;
  useEffect(
    () => mirror?.attach({ agentId, sessionId }),
    [agentId, mirror, sessionId],
  );
  useEffect(() => {
    if (mirror === null || (mirror !== undefined && !mirror.ready)) return;
    if (!seeded) {
      const text =
        prefill?.text ??
        mirror?.text(identity, composer.draft) ??
        composer.draft;
      composer.setDraft(text);
      mirror?.stage(identity, text);
      setSeed({ mirror });
      if (prefill) {
        handled.current = prefill.requestId;
        onPrefilled();
      }
      return;
    }
    if (!prefill || handled.current === prefill.requestId) return;
    handled.current = prefill.requestId;
    composer.setDraft(prefill.text);
    onPrefilled();
  }, [
    composer.draft,
    composer.setDraft,
    identity,
    mirror,
    mirror?.ready,
    onPrefilled,
    prefill,
    seeded,
  ]);
  useEffect(() => {
    if (seeded) mirror?.stage(identity, composer.draft);
  }, [composer.draft, identity, mirror, seeded]);
  if (!seeded) return null;
  const status = mirror?.status(identity);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">{children}</div>
      {mirror && (
        <div
          className="flex h-6 shrink-0 items-center justify-end gap-2 px-2 text-xs text-base-content/60"
          data-draft-status={status}
        >
          <span role="status">
            {status === "restored"
              ? "Draft restored"
              : status === "saving"
                ? "Saving…"
                : status === "not-saved"
                  ? mirror.atStorageLimit()
                    ? "Not saved: storage limit reached"
                    : "Not saved"
                  : "Text saved"}
          </span>
          {mirror.conflicted(identity) ? (
            <>
              <button
                type="button"
                onClick={() => {
                  mirror.choose(identity, "local");
                }}
              >
                Keep mine
              </button>
              <button
                type="button"
                onClick={() => {
                  mirror.choose(identity, "saved");
                  composer.setDraft(mirror.text(identity));
                }}
              >
                Use saved
              </button>
            </>
          ) : status === "not-saved" ? (
            <button
              type="button"
              onClick={() => {
                void mirror.retry();
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
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
  empty,
  agentName,
}: {
  session: ParakeetSession;
  draftIdentity: ParakeetDraftIdentity;
  connection: AppRoot | null;
  commands: ParakeetCommandRuntime;
  prefill?: Readonly<{
    requestId: string;
    text: string;
  }> | null;
  onPrefilled?: () => void;
  /** Open a footer row's conversation; Grove shows it beside this one. */
  onOpen?: ((target: NonNullable<RowV1["open"]>) => void) | undefined;
  /** Whether the host has a model connected; absent when it does not say. */
  models?: SetupState | undefined;
  /** Focus the composer on open, so the person can just type. */
  autoFocus?: boolean | undefined;
  /** What an empty conversation shows; absent, Parakeet's quiet prompt. */
  empty?: ReactNode | undefined;
  /** The Agent's live name, so the composer says "Message <name>…". */
  agentName?: string | undefined;
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
    }),
    [models, ui],
  );
  const onLink = useCallback(
    (href: string) => openAdmissionLink(ui, href),
    [ui],
  );
  const renderToolActions = useCallback(
    (item: ParakeetToolItem) => {
      return ui ? (
        <>
          <FileResultAction item={item} ui={ui} />
          <ImageResultCard item={item} capabilities={capabilities} ui={ui} />
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
      <ComposeDraft
        key={JSON.stringify([draftIdentity.agentId, draftIdentity.sessionId])}
        identity={draftIdentity}
        prefill={prefill}
        onPrefilled={onPrefilled}
      >
        <ApprovalOwners
          key={draftIdentity.sessionId}
          capabilities={capabilities}
          agentId={draftIdentity.agentId}
          sessionId={draftIdentity.sessionId}
        >
          <ParakeetView
            hideSoleAuthor
            onLink={onLink}
            onOpen={onOpen}
            hostFacts={hostFacts}
            autoFocus={autoFocus}
            empty={empty}
            placeholder={
              agentName === undefined || agentName === ""
                ? undefined
                : `Message ${agentName}…`
            }
            composerActionVariant="outline"
            commands={commands}
            renderAssistantAttachment={renderAssistantAttachment}
            formatAssistantText={gameShareDisplayText}
            renderToolActions={renderToolActions}
            claimsToolMedia={claimsToolMedia}
          />
        </ApprovalOwners>
      </ComposeDraft>
    </ParakeetProvider>
  );
}
