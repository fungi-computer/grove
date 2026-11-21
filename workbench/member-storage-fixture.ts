import {
  AppStorageError,
  type AppStorage,
  type ResolvedAppStorage,
} from "@fungi.computer/agar/storage";

/**
 * A local stand-in for the host's App storage, member layer only, with the
 * host's revision compare-and-set and claim. Two Grove frames given the same fixture
 * share it the way two frames of one member share the real store.
 */
export function createFixtureMemberStorage(): AppStorage {
  const layers = new Map<string, NonNullable<ResolvedAppStorage["member"]>>();
  const listeners = new Map<string, Set<(value: ResolvedAppStorage) => void>>();
  const notify = (key: string) =>
    listeners.get(key)?.forEach((listener) => {
      listener(snapshot(key));
    });
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
        notify(key);
        return { revision };
      }),
    reset: ({ key, basedOn }) =>
      Promise.resolve().then(() => {
        admit(key, basedOn);
        layers.delete(key);
        notify(key);
        return { revision: ++revision };
      }),
    claim: ({ key, scope, value }) =>
      Promise.resolve().then(() => {
        if (scope !== "member") throw new AppStorageError("owner_required");
        const current = layers.get(key);
        if (current !== undefined) return { ...current, claimed: false };
        layers.set(key, { value, revision: ++revision });
        notify(key);
        return { value, revision, claimed: true };
      }),
    watch: (key) => {
      const own = new Set<(value: ResolvedAppStorage) => void>();
      const shared =
        listeners.get(key) ?? new Set<(value: ResolvedAppStorage) => void>();
      listeners.set(key, shared);
      const close = () => {
        own.forEach((listener) => shared.delete(listener));
        own.clear();
      };
      return Promise.resolve({
        get: () => snapshot(key),
        subscribe: (listener) => {
          own.add(listener);
          shared.add(listener);
          return () => {
            own.delete(listener);
            shared.delete(listener);
          };
        },
        close,
        [Symbol.dispose]: close,
      });
    },
  };
}
