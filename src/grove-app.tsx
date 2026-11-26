import { useAppContext } from "@fungi.computer/agar/react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { ChatGillProps } from "./chat-gill.js";
import { HeadLoading } from "./head-loading.js";
import { InboxApp } from "./inbox.js";

// The tile's composer and greeting are only for a surface tile; the full
// window never loads them.
const ChatGillApp = lazy(async () => {
  const module = await import("./chat-gill.js");
  return { default: module.ChatGillApp };
});

/**
 * Which Grove this frame is. The host tells a surface tile its Gill through
 * the open params; any other frame is the full Grove window.
 */
export function GroveApp(props: ChatGillProps): React.JSX.Element {
  const context = useAppContext(props.connection);
  const request = context?.openRequest ?? null;
  const requested =
    request?.kind === "navigate"
      ? request.params.find((param) => param.key === "gill")?.value
      : undefined;
  // The request is only present on the launch; the frame keeps its kind.
  const [gill, setGill] = useState<string | null>(null);
  useEffect(() => {
    if (requested !== undefined) setGill(requested);
  }, [requested]);
  return (gill ?? requested) === "chat" ? (
    // The same state the tile draws first, so loading it never leaves a blank frame.
    <Suspense fallback={<HeadLoading message="Getting ready…" />}>
      <ChatGillApp {...props} />
    </Suspense>
  ) : (
    <InboxApp
      connection={props.connection}
      {...(props.services === undefined ? {} : { services: props.services })}
    />
  );
}
