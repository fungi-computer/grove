import { Schema } from "effect";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
 * Inline owner-only rename control for the selected Agent in navigation.
 * Collapsed, it is the Agent's name (`title`) and one small pencil button.
 * Open, the one-field form takes the name's place and width, with compact Save
 * and Cancel keys, and saves or cancels back to the plain name.
 */
export function RenameAgentControl({
  agentId,
  name,
  rename,
  title,
  onEditingChange,
}: {
  agentId: string;
  name: string;
  rename: (agentId: string, name: string) => Promise<boolean>;
  /** The name as the header shows it; the open form replaces it in place. */
  title?: ReactNode;
  /** Lets the header give the open form the whole row. */
  onEditingChange?: (editing: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  // An Agent change or unmount while the form is open must free the header.
  useEffect(
    () => () => {
      onEditingChange?.(false);
    },
    [onEditingChange],
  );
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onEditingChange?.(next);
  };
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
                className="h-7 min-h-0 px-2! text-sm"
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
      <>
        {title}
        <IconButton
          aria-label="Rename Agent"
          icon={<Pencil size={14} aria-hidden="true" />}
          onClick={() => {
            setOpen(true);
          }}
        />
      </>
    );
  return (
    <SchemaForm
      model={model}
      aria-label="Rename Agent"
      footer={null}
      className="min-w-0 flex-1"
    >
      {/* Caps lays a form's body out as a column; the header row is one line. */}
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1 [&_label]:sr-only">
          <FormFields model={model} names={["name"]} />
        </div>
        <Button
          type="submit"
          size="xs"
          className="h-7 min-h-0 pt-0.5! leading-none"
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
      </div>
    </SchemaForm>
  );
}
