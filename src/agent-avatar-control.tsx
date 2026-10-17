import { AgentHead } from "@fungi.computer/parakeet";
import { Button } from "@fungi.computer/caps/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import type { Avatar } from "@fungi.computer/sprite/avatar";
import { useState } from "react";
import { AgentAvatarPicker } from "./agent-avatar-picker.js";

/**
 * The open Agent's head in the conversation header. For an owner it is also
 * the button that changes the Agent's avatar, which every list and
 * conversation of that Agent then wears.
 */
export function AgentAvatarControl({
  agentId,
  name,
  avatar,
  setAvatar,
}: {
  agentId: string;
  name: string;
  avatar: Avatar;
  /** Absent when the host grants no avatar change. */
  setAvatar?: (agentId: string, avatar: Avatar) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Avatar | null>(null);
  const [saving, setSaving] = useState(false);
  const head = <AgentHead avatar={avatar} name={name} size={24} />;
  if (setAvatar === undefined) return <span className="flex-none">{head}</span>;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Change avatar"
        className="flex-none p-0"
        onClick={() => {
          setDraft(avatar);
        }}
      >
        {head}
      </Button>
      <Dialog
        open={draft !== null}
        onOpenChange={(next) => {
          if (!next && !saving) setDraft(null);
        }}
      >
        <DialogContent className="flex flex-col gap-lg" keepMounted={false}>
          <DialogHeader>
            <DialogTitle>{name}'s avatar</DialogTitle>
            <DialogDescription>
              Every conversation with {name} shows this look.
            </DialogDescription>
          </DialogHeader>
          {draft === null ? null : (
            <AgentAvatarPicker
              value={draft}
              disabled={saving}
              onChange={setDraft}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setDraft(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={saving}
              disabled={saving || draft === null}
              onClick={() => {
                if (draft === null) return;
                setSaving(true);
                void setAvatar(agentId, draft).then((saved) => {
                  setSaving(false);
                  if (saved) setDraft(null);
                });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
