import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppStorage } from "@fungi.computer/agar/storage";

/** Rail 2's width range in pixels; the initial width is the default. */
export const listWidthBounds = { min: 224, max: 480, initial: 320 } as const;

export type GroveLayout = Readonly<{
  agentRailOpen: boolean;
  listRailOpen: boolean;
  listWidth: number;
  /** The Agent last selected in the rail; absent while "All agents" is. */
  agentId?: string;
}>;

export const defaultGroveLayout: GroveLayout = {
  agentRailOpen: true,
  listRailOpen: true,
  listWidth: listWidthBounds.initial,
};

/** The App storage key Grove declares for the member's rail layout. */
export const layoutStorageKey = "layout";

const decodeLayout = Schema.decodeUnknownOption(
  Schema.Struct({
    agentRailOpen: Schema.Boolean,
    listRailOpen: Schema.Boolean,
    listWidth: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  }),
);
// Decoded on its own so a bad Agent choice never resets the rail settings.
const decodeAgentId = Schema.decodeUnknownOption(
  Schema.Struct({ agentId: Schema.String }),
);

/** The layout with the Agent choice set, or with the key absent for All agents. */
export function chooseAgent(
  layout: GroveLayout,
  agentId: string | null,
): GroveLayout {
  const { agentRailOpen, listRailOpen, listWidth } = layout;
  const rails = { agentRailOpen, listRailOpen, listWidth };
  // Storage refuses an undefined value, so All agents omits the key.
  return agentId === null ? rails : { ...rails, agentId };
}

export function clampListWidth(width: number): number {
  return Math.round(
    Math.min(listWidthBounds.max, Math.max(listWidthBounds.min, width)),
  );
}

export type LayoutStorage = Pick<AppStorage, "read" | "write">;

/**
 * Read the member's saved rail layout and its revision. Host App storage
 * survives reloads inside the sandboxed frame; a missing or malformed value
 * falls back to the defaults.
 */
export async function readGroveLayout(
  storage: LayoutStorage,
): Promise<{ layout: GroveLayout; revision: number | null }> {
  const saved = await storage.read(layoutStorageKey);
  const decoded = decodeLayout(saved.member?.value);
  const agent = decodeAgentId(saved.member?.value);
  let layout: GroveLayout = defaultGroveLayout;
  if (Option.isSome(decoded)) {
    layout = {
      ...decoded.value,
      listWidth: clampListWidth(decoded.value.listWidth),
    };
    if (Option.isSome(agent))
      layout = { ...layout, agentId: agent.value.agentId };
  }
  return {
    layout,
    revision: saved.member?.revision ?? null,
  };
}

/** Save the layout over the revision last seen; resolves with the new one. */
export async function writeGroveLayout(
  storage: LayoutStorage,
  layout: GroveLayout,
  basedOn: number | null,
): Promise<number> {
  const { revision } = await storage.write({
    key: layoutStorageKey,
    scope: "member",
    basedOn,
    value: layout,
  });
  return revision;
}

/**
 * The rails' collapsed states and rail 2's width, remembered for the member
 * in host App storage. Without storage the layout lasts for the visit.
 */
export function useGroveLayout(
  storage: LayoutStorage | undefined,
): readonly [
  GroveLayout,
  (update: (layout: GroveLayout) => GroveLayout) => void,
  boolean,
] {
  const [layout, setLayout] = useState(defaultGroveLayout);
  const [ready, setReady] = useState(storage === undefined);
  const revision = useRef<number | null>(null);
  const loaded = useRef(false);
  const touched = useRef(false);
  useEffect(() => {
    if (storage === undefined) return;
    let cancelled = false;
    void readGroveLayout(storage).then(
      (saved) => {
        if (cancelled) return;
        revision.current = saved.revision;
        loaded.current = true;
        // A change made before the read returned is newer than the saved one.
        if (!touched.current) setLayout(saved.layout);
        setReady(true);
      },
      (cause: unknown) => {
        console.warn("Grove could not read its saved rail layout", cause);
        loaded.current = true;
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [storage]);
  useEffect(() => {
    if (storage === undefined || !touched.current || !loaded.current) return;
    void writeGroveLayout(storage, layout, revision.current).then(
      (next) => {
        revision.current = next;
      },
      (cause: unknown) => {
        console.warn("Grove could not save its rail layout", cause);
      },
    );
  }, [storage, layout]);
  const update = useCallback((change: (layout: GroveLayout) => GroveLayout) => {
    touched.current = true;
    setLayout(change);
  }, []);
  return [layout, update, ready] as const;
}
