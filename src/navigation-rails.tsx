import {
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
} from "@fungi.computer/caps/components/dialog";

/** Grove's own width, not the viewport's, picks the rails layout: a tiled window is narrow inside a wide screen. */
const desktopMinWidth = 900;

/**
 * Whether the Grove root is wide enough to show both rails beside the
 * conversation. It is null until the first measure, so the rails never mount
 * in the wrong layout and animate closed. An unlaid-out root counts as wide.
 */
export function useNavigationDesktop(
  root: RefObject<HTMLElement | null>,
): boolean | null {
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = (width: number) => {
      setDesktop(width === 0 || width >= desktopMinWidth);
    };
    measure(element.getBoundingClientRect().width);
    // Test DOMs without layout have no ResizeObserver.
    const observer =
      "ResizeObserver" in globalThis
        ? new ResizeObserver(([entry]) => {
            measure(entry.contentRect.width);
          })
        : undefined;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
    };
  }, [root]);
  return desktop;
}

/** Keep one rail tree across viewport changes; Caps owns phone focus and dismissal. */
export function NavigationRails({
  open,
  onOpenChange,
  returnFocus,
  desktop,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLElement>;
  desktop: boolean;
  children: ReactNode;
}) {
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
          className={`grove-nav min-h-0 flex-none rounded-none p-0 overflow-visible max-w-none max-h-none ${desktop ? "static flex w-auto shadow-none" : "fixed inset-y-0 left-0 z-40 w-[min(22rem,88cqw)] data-[open]:flex"}`}
        >
          {children}
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
