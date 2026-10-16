import {
  appAgentComputerSchema,
  type AppAgentCreateInput,
} from "@fungi.computer/agar/agents";
import { useMemo, useRef, type Ref } from "react";
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

const nameSchema = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Give your Agent a name." }),
  Schema.isMaxLength(256, { message: "Use at most 256 characters." }),
);
const readName = Schema.decodeUnknownOption(nameSchema);
const computerSchema = appAgentComputerSchema.annotate(
  field({
    label: "Computer",
    kind: "select",
    options: { new: "New Computer", none: "No Computer" },
  }),
);
const requests = defineIdFamily({
  family: "grove-agent-create-request",
  version: 1,
  kinds: { request: { prefix: "request" } },
});

/** Form owns validation and retry identity; the inbox owns the remote mutation. */
export function CreateAgentForm({
  create,
  canChooseComputer,
  inputRef,
  error,
  onCancel,
}: {
  create: (intent: AppAgentCreateInput) => Promise<boolean>;
  canChooseComputer: boolean;
  inputRef?: Ref<HTMLInputElement>;
  error: string | null;
  onCancel: () => void;
}) {
  const intent = useRef<AppAgentCreateInput | null>(null);
  const schema = useMemo(
    () =>
      Schema.Struct({
        name: nameSchema.annotate(
          field<string>({
            label: "Name",
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
        computer: computerSchema,
      }),
    [inputRef],
  );
  const model = useSchemaForm({
    schema,
    defaultValues: { name: "", computer: appAgentComputerSchema.make("new") },
    onSubmit: async ({ name, computer: selectedComputer }) => {
      const computer = canChooseComputer ? selectedComputer : undefined;
      let request = intent.current;
      if (request?.name !== name || request.computer !== computer) {
        const identity = { name, requestId: requests.request.generate() };
        request = computer === undefined ? identity : { ...identity, computer };
      }
      intent.current = request;
      if (await create(request)) {
        intent.current = null;
        return {
          kind: "saved",
          values: { name: "", computer: appAgentComputerSchema.make("new") },
        };
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
      aria-label="Create Agent"
      footer={
        <FormFooter divider={false} error={error}>
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
          (canChooseComputer && value.computer !== intent.current.computer)
        )
          intent.current = null;
      }}
    >
      <FormFields
        model={model}
        names={canChooseComputer ? ["name", "computer"] : ["name"]}
      />
    </SchemaForm>
  );
}
