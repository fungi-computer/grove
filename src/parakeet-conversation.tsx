import { messageAuthor } from "@fungi.computer/agar/agents";
import { approvals } from "@fungi.computer/agar/approvals";
import {
  PendingApprovalSchema,
  type ApprovalView,
} from "@fungi.computer/approvals";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { Button } from "@fungi.computer/caps/components/button";
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
import type { AppRoot, CapabilityDirectory } from "@fungi.computer/agar";
import type { RowV1 } from "@fungi.computer/gills";
import { openAdmissionLink } from "./admission-link.js";
import { showConversationToast } from "./conversation-toast.js";
import type {
  ParakeetCommandRuntime,
  ParakeetToast,
  ParakeetDraftIdentity,
} from "@fungi.computer/parakeet/headless";
import { FileResultAction } from "./file-result-action.js";
import { ImageResultCard } from "./image-result-card.js";
import { ApprovalCard } from "./approval-card.js";
import { GameShareCard, gameShareDisplayText } from "./game-share-card.js";
import "@fungi.computer/stipe/fonts-mono.css";
import { useCallback, useEffect, useRef, useState } from "react";

const decodePendingApproval = Schema.decodeUnknownOption(
  Schema.fromJsonString(PendingApprovalSchema),
  { onExcessProperty: "error" },
);

function pendingApprovalId(item: ParakeetToolItem): string | undefined {
  if (item.status !== "completed" || item.result?.isError) return undefined;
  for (const part of item.result?.content ?? []) {
    if (part.type !== "text") continue;
    const pending = decodePendingApproval(part.text);
    if (Option.isSome(pending)) return pending.value.recordId;
  }
  return undefined;
}

// The tool result supplies only a locator. The member-bound owner supplies the
// current record and rights; tool metadata cannot authorize an answer.
function ConversationApproval({
  recordId,
  agentId,
  capabilities,
}: {
  recordId: string;
  agentId: string;
  capabilities: CapabilityDirectory;
}) {
  const [loaded, setLoaded] = useState<{
    capabilities: CapabilityDirectory;
    recordId: string;
    view: ApprovalView | null;
    failed: boolean;
  }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    async function read() {
      try {
        const view = await capabilities.require(approvals).get({ recordId });
        if (active) setLoaded({ capabilities, recordId, view, failed: false });
      } catch (cause) {
        console.warn("Grove could not read the approval", cause);
        if (active)
          setLoaded({ capabilities, recordId, view: null, failed: true });
      }
    }
    void read();
    return () => {
      active = false;
    };
  }, [capabilities, recordId, attempt]);
  // Never carry a previous holder's metadata across a capability replacement.
  if (loaded?.capabilities !== capabilities || loaded.recordId !== recordId)
    return null;
  if (loaded.failed)
    return (
      <div>
        <p role="alert">Couldn't load this approval. Try again.</p>
        <Button
          variant="ghost"
          onClick={() => {
            setAttempt((value) => value + 1);
          }}
        >
          Refresh approval
        </Button>
      </div>
    );
  if (loaded.view === null || loaded.view.record.state === "expired")
    return null;
  return (
    <ApprovalCard
      view={loaded.view}
      scope={{ agentId }}
      capabilities={capabilities}
      onViewChange={(view) => {
        setLoaded({ capabilities, recordId, view, failed: false });
      }}
    />
  );
}

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
  prefill: Readonly<{ requestId: string; text: string }> | null;
  onPrefilled: () => void;
}) {
  const composer = useComposer();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!prefill || handled.current === prefill.requestId) return;
    handled.current = prefill.requestId;
    composer.setDraft(prefill.text);
    onPrefilled();
  }, [composer.setDraft, onPrefilled, prefill]);
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
}: {
  session: ParakeetSession;
  draftIdentity: ParakeetDraftIdentity;
  connection: AppRoot | null;
  commands: ParakeetCommandRuntime;
  prefill?: Readonly<{ requestId: string; text: string }> | null;
  onPrefilled?: () => void;
  /** Open a footer row's conversation; Grove shows it beside this one. */
  onOpen?: ((target: NonNullable<RowV1["open"]>) => void) | undefined;
}): React.JSX.Element {
  const ui = connection?.ui ?? null;
  const capabilities = connection?.capabilities;
  const onLink = useCallback(
    (href: string) => openAdmissionLink(ui, href),
    [ui],
  );
  const renderToolActions = useCallback(
    (item: ParakeetToolItem) => {
      const recordId = pendingApprovalId(item);
      if (recordId !== undefined && capabilities !== undefined)
        return (
          <ConversationApproval
            key={recordId}
            recordId={recordId}
            agentId={draftIdentity.agentId}
            capabilities={capabilities}
          />
        );
      return ui ? (
        <>
          <FileResultAction item={item} ui={ui} />
          <ImageResultCard item={item} ui={ui} />
        </>
      ) : null;
    },
    [ui, capabilities, draftIdentity.agentId],
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
      <ParakeetView
        onLink={onLink}
        onOpen={onOpen}
        composerActionVariant="outline"
        commands={commands}
        renderAssistantAttachment={renderAssistantAttachment}
        formatAssistantText={gameShareDisplayText}
        renderToolActions={renderToolActions}
      />
    </ParakeetProvider>
  );
}
