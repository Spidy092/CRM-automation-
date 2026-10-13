import type { FormField } from "@/api/forms";

const contactFields: FormField[] = [
  {
    name: "contact_name",
    label: "Full name",
    type: "text",
    required: true,
    leadField: "contact_name",
    placeholder: "Your full name",
  },
  {
    name: "email",
    label: "Email address",
    type: "email",
    required: true,
    leadField: "email",
    placeholder: "you@company.com",
  },
  {
    name: "phone",
    label: "Phone number",
    type: "phone",
    required: false,
    leadField: "phone",
  },
];

export const formTemplates = [
  {
    key: "contact",
    name: "Contact us",
    description: "Collect enquiries and contact details.",
    fields: [
      ...contactFields,
      {
        name: "message",
        label: "How can we help?",
        type: "textarea",
        required: true,
      },
    ] as FormField[],
  },
  {
    key: "quote",
    name: "Request a quote",
    description: "Understand what a potential customer needs.",
    fields: [
      ...contactFields,
      {
        name: "company",
        label: "Company name",
        type: "text",
        required: true,
        leadField: "business_name",
      },
      {
        name: "requirements",
        label: "What do you need?",
        type: "textarea",
        required: true,
      },
    ] as FormField[],
  },
  {
    key: "demo",
    name: "Book a demo",
    description: "Capture interest in a product demonstration.",
    fields: [
      ...contactFields,
      {
        name: "company",
        label: "Company name",
        type: "text",
        required: true,
        leadField: "business_name",
      },
    ] as FormField[],
  },
];
