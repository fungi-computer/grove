import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";

/** Rail 2's width range in pixels; the initial width is the default. */
export const listWidthBounds = { min: 224, max: 480, initial: 320 } as const;

export type GroveLayout = Readonly<{
  agentRailOpen: boolean;
  listRailOpen: boolean;
  listWidth: number;
}>;

export const defaultGroveLayout: GroveLayout = {
  agentRailOpen: true,
  listRailOpen: true,
  listWidth: listWidthBounds.initial,
};

const storageKey = "fungi.grove.layout.v1";

const decodeLayout = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      agentRailOpen: Schema.Boolean,
      listRailOpen: Schema.Boolean,
      listWidth: Schema.Number.pipe(Schema.check(Schema.isFinite())),
    }),
  ),
);

export function clampListWidth(width: number): number {
  return Math.round(
    Math.min(listWidthBounds.max, Math.max(listWidthBounds.min, width)),
  );
}

/**
 * Read the member's saved rail layout. Storage is a per-browser convenience:
 * blocked, missing or malformed values fall back to the defaults.
 */
export function readGroveLayout(storage: Storage | undefined): GroveLayout {
  try {
    const saved = storage?.getItem(storageKey);
    if (saved === null || saved === undefined) return defaultGroveLayout;
    const layout = decodeLayout(saved);
    return Option.isSome(layout)
      ? { ...layout.value, listWidth: clampListWidth(layout.value.listWidth) }
      : defaultGroveLayout;
  } catch (cause) {
    console.warn("Grove could not read its saved rail layout", cause);
    return defaultGroveLayout;
  }
}

/** Save the layout; a storage failure only loses the convenience. */
export function writeGroveLayout(
  storage: Storage | undefined,
  layout: GroveLayout,
): void {
  try {
    storage?.setItem(storageKey, JSON.stringify(layout));
  } catch (cause) {
    console.warn("Grove could not save its rail layout", cause);
  }
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch (cause) {
    console.warn("Grove rail layout storage is unavailable", cause);
    return undefined;
  }
}

/** The rails' collapsed states and rail 2's width, remembered per browser. */
export function useGroveLayout(): readonly [
  GroveLayout,
  (update: (layout: GroveLayout) => GroveLayout) => void,
] {
  const [layout, setLayout] = useState(() => readGroveLayout(browserStorage()));
  useEffect(() => {
    writeGroveLayout(browserStorage(), layout);
  }, [layout]);
  return [layout, setLayout] as const;
}
