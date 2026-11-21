import { z } from "zod";
import {
  AppStorageError,
  type AppStorage,
  type AppStorageWatch,
  type ResolvedAppStorage,
} from "@fungi.computer/agar/storage";
import type { ParakeetDraftIdentity } from "@fungi.computer/parakeet/headless";

const recordSchema = z.object({
  entries: z.array(
    z.object({ agentId: z.string(), sessionId: z.string(), text: z.string() }),
  ),
});
type Entry = z.infer<typeof recordSchema>["entries"][number];
const keyOf = (owner: ParakeetDraftIdentity) =>
  JSON.stringify([owner.agentId, owner.sessionId]);
const textIn = (entries: Entry[], owner: ParakeetDraftIdentity) =>
  entries.find((entry) => keyOf(entry) === keyOf(owner))?.text ?? "";
export type DraftSaveStatus =
  "loading" | "restored" | "saving" | "saved" | "not-saved";

/** One frame's acknowledged composer text, separate from Parakeet's journal. */
export class DraftMirror {
  ready = false;
  hydrated = false;
  private entries: z.infer<typeof recordSchema>["entries"] = [];
  private watch: AppStorageWatch | undefined;
  private closed = false;
  private unwatch: (() => void) | undefined;
  private observed: ResolvedAppStorage | undefined;
  private revision: number | null = null;
  private desired = new Map<string, Entry>();
  private current = new Map<string, Entry>();
  private mounted = new Map<string, number>();
  private conflicts = new Set<string>();
  private edited = new Set<string>();
  private saving = false;
  private retrying = false;
  private failure = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextWrite = 0;
  private version = 0;
  private listeners = new Set<() => void>();

  getVersion = () => this.version;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.version++;
    this.listeners.forEach((listener) => {
      listener();
    });
  }

  constructor(
    private storage: AppStorage | null,
    private failed: (cause: unknown) => void,
  ) {}

  private isClosed() {
    return this.closed;
  }

  private setError(cause: unknown) {
    if (this.closed) return;
    this.failure = true;
    this.failed(cause);
    this.publish();
  }

  private async armWatch() {
    if (this.storage === null) throw new AppStorageError("unavailable");
    this.unwatch?.();
    this.watch?.close();
    this.watch = undefined;
    const watch = await this.storage.watch("chat-drafts");
    if (this.isClosed()) {
      watch.close();
      return undefined;
    }
    this.watch = watch;
    this.unwatch = watch.subscribe((snapshot) => {
      this.observed = snapshot;
      this.checkForeign();
    });
    return watch.get();
  }

  async start() {
    try {
      const snapshot = await this.armWatch();
      if (snapshot === undefined) return;
      const member = snapshot.member;
      this.entries =
        member === null ? [] : recordSchema.parse(member.value).entries;
      this.revision = member?.revision ?? null;
      this.hydrated = true;
    } catch (cause) {
      this.setError(cause);
    }
    if (!this.closed) {
      this.ready = true;
      this.publish();
    }
  }

  text(owner: ParakeetDraftIdentity, fallback = "") {
    return (
      this.current.get(keyOf(owner))?.text ??
      (this.hydrated ? textIn(this.entries, owner) : fallback)
    );
  }

  attach(owner: ParakeetDraftIdentity) {
    const key = keyOf(owner);
    this.mounted.set(key, (this.mounted.get(key) ?? 0) + 1);
    return () => {
      const remaining = (this.mounted.get(key) ?? 1) - 1;
      if (remaining > 0) this.mounted.set(key, remaining);
      else this.mounted.delete(key);
      this.discardSettled(key);
    };
  }

  private discardSettled(key: string) {
    if (this.mounted.has(key) || this.desired.has(key)) return;
    this.current.delete(key);
    this.edited.delete(key);
  }

  status(owner: ParakeetDraftIdentity): DraftSaveStatus {
    if (!this.ready) return "loading";
    if (this.failure || this.conflicts.size > 0) return "not-saved";
    if (this.desired.has(keyOf(owner))) return "saving";
    return !this.edited.has(keyOf(owner)) && this.text(owner)
      ? "restored"
      : "saved";
  }

  stage(owner: ParakeetDraftIdentity, text: string) {
    if (this.closed || !this.ready) return;
    const previous = this.text(owner);
    this.current.set(keyOf(owner), { ...owner, text });
    if (text === previous) return;
    this.desired.set(keyOf(owner), { ...owner, text });
    this.edited.add(keyOf(owner));
    this.publish();
    this.schedule();
  }

  async retry() {
    if (this.closed || this.saving || this.retrying) return;
    this.retrying = true;
    try {
      const snapshot = await this.armWatch();
      if (snapshot === undefined || this.isClosed()) return;
      const member = snapshot.member;
      const entries =
        member === null ? [] : recordSchema.parse(member.value).entries;
      const conflicts = new Set<string>();
      for (const [key, entry] of this.current) {
        if (
          (this.conflicts.has(key) ||
            textIn(entries, entry) !== textIn(this.entries, entry)) &&
          entry.text !== textIn(entries, entry)
        ) {
          conflicts.add(key);
          this.desired.set(key, entry);
        }
      }
      this.conflicts = conflicts;
      this.entries = entries;
      this.hydrated = true;
      this.revision = member?.revision ?? null;
      this.failure = false;
      this.publish();
      this.schedule();
    } catch (cause) {
      this.setError(cause);
    } finally {
      this.retrying = false;
    }
  }

  conflicted(owner: ParakeetDraftIdentity) {
    return this.conflicts.has(keyOf(owner));
  }

  choose(owner: ParakeetDraftIdentity, choice: "local" | "saved") {
    const key = keyOf(owner);
    if (!this.conflicts.delete(key)) return;
    if (choice === "saved") {
      this.current.set(key, { ...owner, text: textIn(this.entries, owner) });
      this.desired.delete(key);
    }
    this.publish();
    this.schedule();
  }

  private schedule() {
    if (
      this.closed ||
      this.failure ||
      this.conflicts.size > 0 ||
      this.saving ||
      this.timer !== undefined ||
      this.desired.size === 0
    )
      return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.save();
      },
      Math.max(0, this.nextWrite - Date.now()),
    );
  }

  private checkForeign() {
    if (this.closed || this.saving || this.observed === undefined) return;
    const revision = this.observed.member?.revision ?? null;
    this.observed = undefined;
    if (
      revision === this.revision ||
      (revision !== null && this.revision !== null && revision < this.revision)
    )
      return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.failure) {
      this.setError(new AppStorageError("conflict"));
    }
  }

  private async save() {
    if (this.storage === null) return;
    this.saving = true;
    this.nextWrite = Date.now() + 1000;
    const staged = new Map(this.desired);
    const entries = [
      ...this.entries.filter((entry) => !staged.has(keyOf(entry))),
      ...staged.values(),
    ].filter((entry) => entry.text !== "");
    try {
      const ack = await this.storage.write({
        key: "chat-drafts",
        scope: "member",
        basedOn: this.revision,
        value: { entries },
      });
      if (this.closed) return;
      this.entries = entries;
      this.revision = ack.revision;
      for (const [key, entry] of staged) {
        if (this.desired.get(key)?.text === entry.text) {
          this.desired.delete(key);
          this.discardSettled(key);
        }
      }
    } catch (cause) {
      this.setError(cause);
    } finally {
      this.saving = false;
      if (!this.closed) {
        this.checkForeign();
        this.publish();
        this.schedule();
      }
    }
  }

  close() {
    this.closed = true;
    this.unwatch?.();
    this.watch?.close();
    if (this.timer !== undefined) clearTimeout(this.timer);
  }
}
