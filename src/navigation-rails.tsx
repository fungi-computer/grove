import {
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
} from "@fungi.computer/caps/components/dialog";

const desktopQuery = "(min-width: 900px)";
function subscribe(onChange: () => void) {
  const media = globalThis.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}
function isDesktop() {
  return globalThis.matchMedia(desktopQuery).matches;
}

export function useNavigationDesktop() {
  return useSyncExternalStore(subscribe, isDesktop, () => true);
}

/** Keep one rail tree across viewport changes; Caps owns phone focus and dismissal. */
export function NavigationRails({
  open,
  onOpenChange,
  returnFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLElement>;
  children: ReactNode;
}) {
  const desktop = useNavigationDesktop();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <Dialog
      open={desktop || open}
      modal={!desktop}
      disablePointerDismissal={desktop}
      onOpenChange={(next) => {
        if (!desktop) onOpenChange(next);
      }}
    >
      <div ref={setContainer} className="contents" />
      <DialogPortal container={container} keepMounted className="contents">
        {!desktop ? (
          <DialogBackdrop className="grove-nav-scrim z-30 bg-base-200" />
        ) : null}
        <DialogPopup
          id="grove-nav"
          role={desktop ? "presentation" : "dialog"}
          aria-label={desktop ? undefined : "Agents and conversations"}
          initialFocus={desktop ? false : undefined}
          finalFocus={desktop ? false : returnFocus}
          className={`grove-nav min-h-0 flex-none rounded-none p-0 overflow-visible max-w-none max-h-none ${desktop ? "static flex w-auto shadow-none" : "fixed inset-y-0 left-0 z-40 w-[min(22rem,88vw)] data-[open]:flex"}`}
        >
          {children}
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
