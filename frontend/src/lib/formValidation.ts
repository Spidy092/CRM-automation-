import { z } from "zod/v4";
import type { FormField } from "@/api/forms";

const definition = z
  .object({
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_]+$/)
      .refine(
        (value) => !["__proto__", "constructor", "prototype"].includes(value),
        "Choose a different field name",
      ),
    label: z.string().trim().min(1, "Give every field a label").max(200),
    type: z.enum([
      "text",
      "email",
      "phone",
      "number",
      "textarea",
      "select",
      "checkbox",
      "hidden",
    ]),
    required: z.boolean(),
    placeholder: z.string().max(200).optional(),
    options: z.array(z.string()).optional(),
    defaultValue: z.string().optional(),
    leadField: z.string().optional(),
  })
  .refine(
    (field) => field.type !== "select" || Boolean(field.options?.length),
    "Add options to the dropdown",
  );

const notificationSchema = z
  .object({
    enabled: z.boolean(),
    emails: z.string().optional(),
    subject: z.string().max(500).optional(),
    body: z.string().max(20000).optional(),
  })
  .refine(
    (value) =>
      !value.enabled ||
      Boolean(
        value.emails?.trim() && value.subject?.trim() && value.body?.trim(),
      ),
    "Add recipients, a subject, and a message for enabled notifications",
  );
export const emailSettingsSchema = z.object({
  autoReply: z
    .object({
      enabled: z.boolean(),
      fromName: z.string().optional(),
      fromEmail: z.string().optional(),
      subject: z.string().max(500).optional(),
      body: z.string().max(20000).optional(),
    })
    .refine(
      (value) =>
        !value.enabled || Boolean(value.subject?.trim() && value.body?.trim()),
      "Add a subject and message for the confirmation email",
    )
    .refine(
      (value) =>
        !value.fromEmail ||
        z.string().email().safeParse(value.fromEmail).success,
      "Enter a valid sender email address",
    )
    .optional(),
  teamNotification: notificationSchema.optional(),
  partnerNotification: notificationSchema.optional(),
});

export const builderSchema = z
  .object({
    name: z.string().trim().min(1, "Give your form a name").max(255),
    slug: z
      .string()
      .max(100)
      .regex(
        /^[a-z0-9-]*$/,
        "Use lowercase letters, numbers, and hyphens for the address",
      ),
    description: z.string().max(2000),
    fields: z
      .array(definition)
      .min(1)
      .max(100)
      .refine(
        (fields) =>
          new Set(fields.map((field) => field.name)).size === fields.length,
        "Each field needs a unique name",
      ),
    submitAction: z.enum(["create_lead", "send_email", "redirect"]),
    submitMessage: z.string().max(500),
    redirectUrl: z.union([
      z.literal(""),
      z
        .string()
        .url()
        .refine(
          (value) => /^https?:\/\//i.test(value),
          "Use a website address beginning with https://",
        ),
    ]),
    isActive: z.boolean(),
    emailSettings: emailSettingsSchema,
  })
  .refine(
    (value) => value.submitAction !== "redirect" || Boolean(value.redirectUrl),
    {
      message: "Add the website address visitors should open",
      path: ["redirectUrl"],
    },
  );
export type BuilderValues = z.infer<typeof builderSchema>;

export function publicFormSchema(fields: FormField[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    if (field.type === "checkbox") {
      shape[field.name] = field.required
        ? z.boolean().refine((value) => value, `${field.label} must be checked`)
        : z.boolean();
      continue;
    }
    let text = z
      .string()
      .trim()
      .max(5000, "Keep your answer under 5,000 characters");
    if (field.required) text = text.min(1, `${field.label} is required`);
    let schema: z.ZodType = text;
    if (field.type === "email")
      schema = text.refine(
        (value) =>
          (!field.required && !value) ||
          z.string().email().safeParse(value).success,
        "Enter a valid email address",
      );
    if (field.type === "number")
      schema = text.refine(
        (value) =>
          (!field.required && !value) ||
          (value !== "" && Number.isFinite(Number(value))),
        "Enter a valid number",
      );
    if (field.type === "select")
      schema = text.refine(
        (value) =>
          (!field.required && !value) ||
          Boolean(field.options?.includes(value)),
        "Choose an option from the list",
      );
    if (!["__proto__", "constructor", "prototype"].includes(field.name))
      shape[field.name] = schema;
  }
  return z.object(shape);
}
