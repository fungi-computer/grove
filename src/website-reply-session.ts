import { AppError } from "@fungi.computer/agar";
import type { AppChannelsManageHandle } from "@fungi.computer/agar/channels";
import type {
  ParakeetPromptResult,
  ParakeetSession,
} from "@fungi.computer/parakeet";
import type {
  AbortCommand,
  BranchCommand,
  CancelCommand,
  CancelResult,
  ForkCommand,
  ForkedSession,
  OperatorCommand,
  CompactCommand,
  TitleCommand,
  PromptCommand,
  SessionCommand,
} from "@fungi.computer/shiitake/client";

export function createWebsiteReplySession(
  source: ParakeetSession,
  owner: Readonly<{
    bindingId: string;
    sessionId: string;
    canReply: () => boolean;
    reply: AppChannelsManageHandle["reply"];
  }>,
): ParakeetSession {
  function command(
    input: PromptCommand | CompactCommand,
  ): Promise<ParakeetPromptResult>;
  function command(input: CancelCommand): Promise<CancelResult>;
  function command(
    input: AbortCommand | BranchCommand | OperatorCommand | TitleCommand,
  ): Promise<undefined>;
  function command(input: ForkCommand): Promise<ForkedSession>;
  function command(
    input: SessionCommand,
  ): Promise<ParakeetPromptResult | CancelResult | ForkedSession | undefined>;
  async function command(
    input: SessionCommand,
  ): Promise<ParakeetPromptResult | CancelResult | ForkedSession | undefined> {
    if (input.type !== "prompt" || (input.images?.length ?? 0) > 0)
      throw new AppError("Website conversations support text replies only", {
        code: "COMMAND_NOT_DECLARED",
        retryable: false,
      });
    if (!owner.canReply())
      throw new AppError("Use Take over to reply to this visitor", {
        code: "CAPABILITY_DENIED",
        retryable: false,
      });
    await owner.reply({
      bindingId: owner.bindingId,
      sessionId: owner.sessionId,
      requestId: input.requestId,
      text: input.text,
    });
    return { status: "recorded" };
  }
  return {
    address: source.address,
    read: (options) => source.read(options),
    watch: (options) => source.watch(options),
    extension: () => ({
      call: () =>
        Promise.reject(
          new AppError("Website Session controls are unavailable", {
            code: "COMMAND_NOT_DECLARED",
            retryable: false,
          }),
        ),
    }),
    command,
  };
}
