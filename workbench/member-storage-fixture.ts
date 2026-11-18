import {
  AppStorageError,
  type AppStorage,
  type ResolvedAppStorage,
} from "@fungi.computer/agar/storage";

/**
 * A local stand-in for the host's App storage, member layer only, with the
 * host's revision compare-and-set. Two Grove frames given the same fixture
 * share it the way two frames of one member share the real store.
 */
export function createFixtureMemberStorage(): AppStorage {
  const layers = new Map<string, NonNullable<ResolvedAppStorage["member"]>>();
  let revision = 0;
  const snapshot = (key: string): ResolvedAppStorage => {
    const member = layers.get(key) ?? null;
    return {
      value: member?.value ?? null,
      source: member ? "member" : "none",
      team: null,
      member,
      canWriteTeam: false,
    };
  };
  const admit = (key: string, basedOn: number | null) => {
    if ((layers.get(key)?.revision ?? null) !== basedOn)
      throw new AppStorageError("conflict");
  };
  return {
    read: (key) => Promise.resolve(snapshot(key)),
    write: ({ key, scope, basedOn, value }) =>
      Promise.resolve().then(() => {
        if (scope !== "member") throw new AppStorageError("owner_required");
        admit(key, basedOn);
        layers.set(key, { value, revision: ++revision });
        return { revision };
      }),
    reset: ({ key, basedOn }) =>
      Promise.resolve().then(() => {
        admit(key, basedOn);
        layers.delete(key);
        return { revision: ++revision };
      }),
    watch: () => Promise.reject(new Error("The fixture has no watch")),
  };
}
