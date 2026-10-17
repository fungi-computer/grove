import { AgentHead } from "@fungi.computer/parakeet";
import {
  RadioGroup,
  RadioGroupCard,
  RadioGroupItem,
} from "@fungi.computer/caps/components/radio-group";
import {
  avatarCharacters,
  avatarEnvelopeSchema,
  type Avatar,
  type AvatarCharacter,
} from "@fungi.computer/sprite/avatar";
import { avatarCatalog } from "@fungi.computer/sprite-zdog/catalog";
import { useId } from "react";

const names = { mushroom: "Shiitake", cat: "Cat", burger: "Burger" };
/** Identity colour pairs: the primary slot, then its accent. */
const swatches = [
  ["Rose", "#f98284", "#ffe6c6"],
  ["Peach", "#f6a55c", "#ffe9c9"],
  ["Gold", "#f2d06b", "#fff6d1"],
  ["Leaf", "#9bd47a", "#e6f8d8"],
  ["Mint", "#5fc7b4", "#d9f6ef"],
  ["Sky", "#6aaee8", "#dcefff"],
  ["Lilac", "#9b8cf0", "#ebe6ff"],
  ["Plum", "#e58bd6", "#fbe2f6"],
] as const;

/**
 * Move an avatar to `character`, carrying its identity colours slot for slot
 * so a seeded or chosen colour survives the switch.
 */
function asCharacter(avatar: Avatar, character: AvatarCharacter): Avatar {
  if (character === avatar.character) return avatar;
  const from = avatarCatalog[avatar.character].identitySlots;
  const to = avatarCatalog[character].identitySlots;
  const appearance = Object.fromEntries(
    to.flatMap((slot, index) => {
      const source = from[index];
      return Object.hasOwn(avatar.appearance, source)
        ? [[slot, avatar.appearance[source]]]
        : [];
    }),
  );
  return { ...avatar, character, appearance, expression: "normal" };
}

/**
 * A small Agent avatar picker over Sprite's closed character catalog: one
 * character and one identity colour. The caller owns saving.
 */
export function AgentAvatarPicker({
  value,
  disabled = false,
  onChange,
}: {
  value: Avatar;
  disabled?: boolean;
  onChange: (next: Avatar) => void;
}) {
  const id = useId();
  const slots = avatarCatalog[value.character].identitySlots;
  const selectedSwatch =
    swatches.find(([, primary, accent]) =>
      slots.every(
        (slot, index) =>
          value.appearance[slot] === (index === 0 ? primary : accent),
      ),
    )?.[0] ?? "";
  return (
    <div className="flex flex-col gap-sm">
      <RadioGroup
        aria-label="Character"
        className="grid grid-cols-3 gap-sm"
        disabled={disabled}
        orientation="horizontal"
        value={value.character}
        onValueChange={(raw) => {
          onChange(
            asCharacter(value, avatarEnvelopeSchema.shape.character.parse(raw)),
          );
        }}
      >
        {avatarCharacters.map((character) => (
          <RadioGroupCard
            key={character}
            id={`${id}-${character}`}
            value={character}
            title={names[character]}
            description={
              <AgentHead
                avatar={asCharacter(value, character)}
                name={names[character]}
                size={40}
              />
            }
          />
        ))}
      </RadioGroup>
      <RadioGroup
        aria-label="Colour"
        className="flex flex-wrap gap-xs"
        disabled={disabled}
        orientation="horizontal"
        value={selectedSwatch}
        onValueChange={(name) => {
          const swatch = swatches.find(([label]) => label === name);
          if (!swatch) return;
          onChange({
            ...value,
            appearance: {
              ...value.appearance,
              ...Object.fromEntries(
                slots.map((slot, index) => [slot, swatch[index === 0 ? 1 : 2]]),
              ),
            },
          });
        }}
      >
        {swatches.map(([name, colour]) => (
          <label
            key={name}
            title={name}
            className="grid size-9 cursor-pointer place-items-center rounded-full border border-base-300"
            style={{ backgroundColor: colour }}
          >
            <RadioGroupItem value={name} aria-label={name} />
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}
