import { AgentHead } from "@fungi.computer/parakeet";
import { FieldSet } from "@fungi.computer/caps/components/field";
import {
  IconRadio,
  SwatchRadio,
} from "@fungi.computer/caps/components/icon-radio";
import { RadioGroup } from "@fungi.computer/caps/components/radio-group";
import { Sigil } from "@fungi.computer/sigils";
import {
  avatarCharacters,
  avatarEnvelopeSchema,
  type Avatar,
  type AvatarCharacter,
} from "@fungi.computer/sprite/avatar";
import { avatarCatalog } from "@fungi.computer/sprite-zdog/catalog";

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
type Swatch = (typeof swatches)[number];

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

/** Paint an avatar's identity slots with one swatch's primary and accent. */
function withSwatch(avatar: Avatar, [, primary, accent]: Swatch): Avatar {
  const slots = avatarCatalog[avatar.character].identitySlots;
  return {
    ...avatar,
    appearance: {
      ...avatar.appearance,
      ...Object.fromEntries(
        slots.map((slot, index) => [slot, index === 0 ? primary : accent]),
      ),
    },
  };
}

/**
 * A new Agent's first look: the seeded avatar painted with one of the
 * picker's colours, chosen by the seed so two new Agents rarely match.
 */
export function swatchedAvatar(avatar: Avatar, seed: string): Avatar {
  let sum = 0;
  for (const character of seed) sum += character.codePointAt(0) ?? 0;
  const swatch = swatches[sum % swatches.length] ?? swatches[0];
  return withSwatch(avatar, swatch);
}

/**
 * The Agent avatar rows of a form: one character key and one colour key,
 * labelled like every other field. The caller owns saving.
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
  const slots = avatarCatalog[value.character].identitySlots;
  const selectedSwatch =
    swatches.find(([, primary, accent]) =>
      slots.every(
        (slot, index) =>
          value.appearance[slot] === (index === 0 ? primary : accent),
      ),
    )?.[0] ?? "";
  return (
    <>
      <FieldSet
        legend="Avatar"
        icon={<Sigil name="agent" />}
        layout="columns"
        disabled={disabled}
      >
        <RadioGroup
          aria-label="Character"
          className="caps-field-icon-choices"
          disabled={disabled}
          orientation="horizontal"
          value={value.character}
          onValueChange={(raw) => {
            onChange(
              asCharacter(
                value,
                avatarEnvelopeSchema.shape.character.parse(raw),
              ),
            );
          }}
        >
          {avatarCharacters.map((character) => (
            <IconRadio
              key={character}
              value={character}
              label={names[character]}
              caption={names[character]}
              art="color"
              icon={
                <AgentHead
                  avatar={asCharacter(value, character)}
                  name={names[character]}
                  size={32}
                />
              }
            />
          ))}
        </RadioGroup>
      </FieldSet>
      <FieldSet
        legend="Colour"
        icon={<Sigil name="prints" />}
        layout="columns"
        disabled={disabled}
      >
        <RadioGroup
          aria-label="Colour"
          className="caps-field-icon-choices"
          disabled={disabled}
          orientation="horizontal"
          value={selectedSwatch}
          onValueChange={(name) => {
            const swatch = swatches.find(([label]) => label === name);
            if (swatch) onChange(withSwatch(value, swatch));
          }}
        >
          {swatches.map(([name, colour]) => (
            <SwatchRadio key={name} value={name} label={name} color={colour} />
          ))}
        </RadioGroup>
      </FieldSet>
    </>
  );
}
