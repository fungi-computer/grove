import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AppRoot } from "@fungi.computer/agar";
import { appStorage, AppStorageError } from "@fungi.computer/agar/storage";
import { DraftMirror } from "./draft-mirror.js";
import { showConversationToast } from "./conversation-toast.js";
import { toast, Toaster } from "@fungi.computer/caps/components/toaster";

const Context = createContext<DraftMirror | null | undefined>(undefined);
const toasterId = "grove-drafts";
const conflictId = "grove-draft-conflict";

/** The App connection owns one mirror across all of its conversation panes. */
export function DraftMirrorProvider({
  connection,
  children,
}: {
  connection: AppRoot | null;
  children: ReactNode;
}) {
  const subscribeCapabilities = useCallback(
    (listener: () => void) =>
      connection?.capabilities.subscribe(listener) ?? subscribeNone(),
    [connection],
  );
  const version = useSyncExternalStore(
    subscribeCapabilities,
    () => connection?.capabilities.version ?? 0,
  );
  const [owner, setOwner] = useState<{
    connection: AppRoot;
    version: number;
    mirror: DraftMirror;
  }>();
  useEffect(() => {
    if (connection === null) return;
    const mirror: DraftMirror = new DraftMirror(
      connection.capabilities.has(appStorage)
        ? connection.capabilities.require(appStorage)
        : null,
      (cause) => {
        const reason =
          cause instanceof AppStorageError ? cause.code : "unavailable";
        if (reason === "conflict") {
          toast.error(
            "This draft changed in another tab. Your text is still here.",
            {
              id: conflictId,
              toasterId,
              closeButton: true,
              action: {
                label: "Review",
                onClick: () => {
                  void mirror.retry();
                },
              },
            },
          );
          return;
        }
        showConversationToast(connection.ui, {
          variant: "error",
          message:
            reason === "too_large" || reason === "quota_exceeded"
              ? "Draft text could not be saved: a storage limit was reached. Your text is still here and can be sent."
              : "Draft text could not be saved. Your text is still here; retry to check storage.",
        });
      },
    );
    setOwner({ connection, version, mirror });
    void mirror.start();
    return () => {
      mirror.close();
      toast.dismiss(conflictId);
    };
  }, [connection, version]);
  return (
    <Context.Provider
      value={
        connection === null
          ? undefined
          : owner?.connection === connection && owner.version === version
            ? owner.mirror
            : null
      }
    >
      {children}
      <Toaster id={toasterId} />
    </Context.Provider>
  );
}

const subscribeNone = () => () => undefined;
const versionNone = () => 0;
export function useDraftMirror() {
  const mirror = useContext(Context);
  useSyncExternalStore(
    mirror?.subscribe ?? subscribeNone,
    mirror?.getVersion ?? versionNone,
  );
  return mirror;
}
