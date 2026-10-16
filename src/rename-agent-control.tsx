import { Schema } from "effect";
import { useMemo, useState } from "react";
import {
  FormFields,
  SchemaForm,
  field,
  useSchemaForm,
  useSchemaFormStatus,
} from "@fungi.computer/caps/form";
import { Button } from "@fungi.computer/caps/components/button";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Input } from "@fungi.computer/caps/components/input";
import { Pencil, X } from "lucide-react";

const nameSchema = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Give your Agent a name." }),
  Schema.isMaxLength(256, { message: "Use at most 256 characters." }),
);

/**
 * Inline owner-only rename control for the open Agent's header. Collapsed, it
 * is one small pencil button; open, it is a one-field form that saves or
 * cancels back to the plain name.
 */
export function RenameAgentControl({
  agentId,
  name,
  rename,
}: {
  agentId: string;
  name: string;
  rename: (agentId: string, name: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const schema = useMemo(
    () =>
      Schema.Struct({
        name: nameSchema.annotate(
          field<string>({
            label: "Agent name",
            render: (control) => (
              <Input
                id={control.id}
                name={control.name}
                aria-label="Agent name"
                aria-invalid={control["aria-invalid"]}
                aria-describedby={control["aria-describedby"]}
                autoFocus
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
      }),
    [],
  );
  const model = useSchemaForm({
    schema,
    defaultValues: { name },
    onSubmit: async ({ name: next }) => {
      if (next === name || (await rename(agentId, next))) {
        setOpen(false);
        return { kind: "saved" as const, values: { name: next } };
      }
      return { kind: "refused" as const };
    },
  });
  const { submitting, canSubmit } = useSchemaFormStatus(model);
  if (!open)
    return (
      <IconButton
        aria-label="Rename Agent"
        icon={<Pencil size={14} aria-hidden="true" />}
        onClick={() => {
          setOpen(true);
        }}
      />
    );
  return (
    <SchemaForm
      model={model}
      aria-label="Rename Agent"
      footer={null}
      className="flex min-w-0 items-center gap-1"
    >
      <div className="min-w-0 flex-1">
        <FormFields model={model} names={["name"]} />
      </div>
      <Button
        type="submit"
        size="sm"
        loading={submitting}
        disabled={submitting || !canSubmit}
      >
        Save
      </Button>
      <IconButton
        aria-label="Cancel rename"
        type="button"
        icon={<X size={14} aria-hidden="true" />}
        onClick={() => {
          setOpen(false);
        }}
      />
    </SchemaForm>
  );
}
