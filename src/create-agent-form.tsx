import { useMutation } from "@tanstack/react-query";
import { SetupNotice } from "@fungi.computer/caps/blocks/setup-notice";
import type {
  AppAgentComputer,
  AppAgentComputerChoice,
  AppAgentCreateInput,
} from "@fungi.computer/agar/agents";
import { seededAvatar, type Avatar } from "@fungi.computer/sprite/avatar";
import { useMemo, useRef, useState, type Ref } from "react";
import { Option, Schema } from "effect";
import { defineIdFamily } from "@fungi.computer/cairn/id";
import {
  FormFields,
  SchemaForm,
  field,
  useSchemaForm,
  useSchemaFormStatus,
} from "@fungi.computer/caps/form";
import { FormFooter } from "@fungi.computer/caps/components/field";
import { Button } from "@fungi.computer/caps/components/button";
import { Input } from "@fungi.computer/caps/components/input";
import { Sigil } from "@fungi.computer/sigils";
import { AgentAvatarPicker, swatchedAvatar } from "./agent-avatar-picker.js";

const nameSchema = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Give your Agent a name." }),
  Schema.isMaxLength(256, { message: "Use at most 256 characters." }),
);
const readName = Schema.decodeUnknownOption(nameSchema);
/** One select value per choice: an existing Computer's id, "new" or "none". */
const choiceValue = (choice: AppAgentComputer) =>
  choice === "new" || choice === "none" ? choice : choice.computerId;
const choiceOf = (value: string): AppAgentComputer =>
  value === "new" || value === "none" ? value : { computerId: value };
/** The Team's newest Computer, or no Computer when the Team has none. */
const defaultChoice = (computers: readonly AppAgentComputerChoice[] | null) =>
  computers?.[0]?.computerId ?? "none";

function computerField(
  computers: readonly AppAgentComputerChoice[],
  unavailable: string | null,
) {
  const options: Record<string, string> = Object.fromEntries(
    computers.map((computer) => [computer.computerId, computer.name]),
  );
  options.new = "New Computer";
  options.none = "No Computer";
  const shown = {
    label: "Computer",
    kind: "select",
    icon: <Sigil name="computer" />,
    options,
  } as const;
  return Schema.String.check(
    Schema.makeFilter(
      (value) => Object.hasOwn(options, value) || "Choose a Computer.",
    ),
  ).annotate(
    field(unavailable === null ? shown : { ...shown, help: unavailable }),
  );
}
const requests = defineIdFamily({
  family: "grove-agent-create-request",
  version: 1,
  kinds: { request: { prefix: "request" } },
});

/** Form owns validation and retry identity; the inbox owns the remote mutation. */
export function CreateAgentForm({
  create,
  computers,
  computersUnavailable,
  inputRef,
  error,
  addCredit,
  onCancel,
}: {
  create: (intent: AppAgentCreateInput) => Promise<boolean>;
  /** The Team's Computers, newest first; null when the host offers no choice. */
  computers: readonly AppAgentComputerChoice[] | null;
  /** Why the Team's Computers could not be read; New and No Computer remain. */
  computersUnavailable: string | null;
  inputRef?: Ref<HTMLInputElement>;
  error: string | null;
  addCredit: (() => Promise<void>) | null;
  onCancel: () => void;
}) {
  const intent = useRef<AppAgentCreateInput | null>(null);
  // The avatar is a structured choice beside the form's text fields; a fresh
  // seeded colour per form keeps two new Agents from defaulting to one look.
  const [avatar, setAvatar] = useState<Avatar>(() => {
    const seed = requests.request.generate();
    return swatchedAvatar(seededAvatar(seed), seed);
  });
  const schema = useMemo(
    () =>
      Schema.Struct({
        name: nameSchema.annotate(
          field<string>({
            label: "Name",
            icon: <Sigil name="write" />,
            // The dialog owns initial focus; the form keeps the native field name.
            render: (control) => (
              <Input
                ref={inputRef}
                id={control.id}
                name={control.name}
                aria-label="New Agent name"
                aria-required="true"
                aria-describedby={control["aria-describedby"]}
                aria-invalid={control["aria-invalid"]}
                placeholder="Name your Agent"
                maxLength={256}
                disabled={control.disabled}
                value={control.value}
                onBlur={control.onBlur}
                onChange={(event) => {
                  control.onChange(event.currentTarget.value);
                }}
              />
            ),
          }),
        ),
        computer: computerField(computers ?? [], computersUnavailable),
      }),
    [inputRef, computers, computersUnavailable],
  );
  const canChooseComputer = computers !== null;
  // A name is all a first Agent needs; Computer and look keep sensible defaults.
  const [moreOpen, setMoreOpen] = useState(false);
  const initial = { name: "", computer: defaultChoice(computers) };
  const model = useSchemaForm({
    schema,
    defaultValues: initial,
    onSubmit: async ({ name, computer: selected }) => {
      const computer = canChooseComputer ? choiceOf(selected) : undefined;
      let request = intent.current;
      if (
        request?.name !== name ||
        (request.computer === undefined
          ? undefined
          : choiceValue(request.computer)) !==
          (computer === undefined ? undefined : choiceValue(computer)) ||
        request.avatar !== avatar
      ) {
        const identity = {
          name,
          requestId: requests.request.generate(),
          avatar,
        };
        request = computer === undefined ? identity : { ...identity, computer };
      }
      intent.current = request;
      if (await create(request)) {
        intent.current = null;
        return { kind: "saved", values: initial };
      }
      // Keep the draft and request identity for retry; the footer shows Query errors.
      return { kind: "refused" };
    },
  });
  const { submitting, canSubmit, dirty } = useSchemaFormStatus(model);
  const submit = (
    <Button
      type="submit"
      className="shrink-0 disabled:-outline-offset-1"
      variant="primary"
      loading={submitting}
      disabled={submitting || !canSubmit || !dirty}
    >
      Create Agent
    </Button>
  );
  return (
    <SchemaForm
      model={model}
      layout="columns"
      aria-label="Create Agent"
      footer={
        <FormFooter divider={false} error={addCredit === null ? error : null}>
          <Button
            type="button"
            variant="ghost"
            aria-expanded={moreOpen}
            onClick={() => {
              setMoreOpen((open) => !open);
            }}
          >
            {moreOpen ? "Fewer options" : "More options"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={onCancel}
          >
            Cancel
          </Button>
          {submit}
        </FormFooter>
      }
      onSubmitCapture={(event) => {
        if (Option.isNone(readName(model.form.state.values.name)))
          event.currentTarget
            .querySelector<HTMLInputElement>('input[name="name"]')
            ?.focus();
      }}
      onChange={() => {
        const value = model.form.state.values;
        if (
          value.name.trim() !== intent.current?.name ||
          (canChooseComputer &&
            intent.current.computer !== undefined &&
            value.computer !== choiceValue(intent.current.computer))
        )
          intent.current = null;
      }}
    >
      {addCredit === null ? null : (
        <AgentCreditNotice openBilling={addCredit} />
      )}
      <FormFields
        model={model}
        names={canChooseComputer && moreOpen ? ["name", "computer"] : ["name"]}
      />
      {moreOpen ? (
        <AgentAvatarPicker
          value={avatar}
          disabled={submitting}
          onChange={(next) => {
            setAvatar(next);
            intent.current = null;
          }}
        />
      ) : null}
    </SchemaForm>
  );
}

/** The host owns Billing; a refusal keeps this form and its draft mounted. */
function AgentCreditNotice({
  openBilling,
}: {
  openBilling: () => Promise<void>;
}) {
  const billing = useMutation({ mutationFn: openBilling });
  return (
    <SetupNotice
      variant="inline"
      need="Add credit to create your Agent"
      cause={
        billing.isError
          ? "Billing could not open. Try again."
          : "This Team needs credit to run Agents and Computers."
      }
      fix={{
        label: billing.isError ? "Retry Billing" : "Add credit",
        onSelect: () => {
          billing.mutate();
        },
        pending: billing.isPending,
      }}
      waitingFor="Billing"
    />
  );
}
