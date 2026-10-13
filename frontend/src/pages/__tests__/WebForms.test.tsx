import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "@/lib/test-utils";
import { apiClient } from "@/api/client";
import { FormsPage } from "../FormsPage";
import { FormBuilderPage } from "../FormBuilderPage";
import { PublicFormPage } from "../PublicFormPage";

vi.mock("@/api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
const form = {
  id: "form-1",
  name: "Contact us",
  slug: "contact-us",
  description: "",
  fields: [
    {
      name: "contact_name",
      label: "Full name",
      type: "text",
      required: true,
      leadField: "contact_name",
    },
    {
      name: "email",
      label: "Email address",
      type: "email",
      required: true,
      leadField: "email",
    },
    {
      name: "consent",
      label: "I agree to be contacted",
      type: "checkbox",
      required: true,
    },
  ],
  is_active: true,
  submit_action: "create_lead",
  submit_message: "Thanks!",
  email_settings: {},
  redirect_url: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === "/forms/admin"
          ? []
          : url.toString().endsWith("/embed")
            ? { snippet: '<iframe title="Contact us"></iframe>' }
            : { ...form, submitMessage: "Thanks!" },
      meta: { total: 0 },
    },
  }));
  vi.mocked(apiClient.post).mockResolvedValue({
    data: { success: true, data: form },
  });
});
function app(entry: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/forms" element={<FormsPage />} />
      <Route path="/forms/new" element={<FormBuilderPage />} />
      <Route path="/forms/:id/edit" element={<FormBuilderPage />} />
      <Route path="/forms/:slug" element={<PublicFormPage />} />
    </Routes>,
    { initialEntries: [entry] },
  );
}
describe("Web Forms", () => {
  it("takes a template through preview, saving, and publishing without a real test submission", async () => {
    const user = userEvent.setup();
    app("/forms");
    await user.click(
      await screen.findByRole("button", { name: "Use contact us" }),
    );
    expect(await screen.findByDisplayValue("Contact us")).toBeVisible();
    expect(screen.getByLabelText("Form preview")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next: follow-up" }));
    expect(screen.getByLabelText("On Submit")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next: review" }));
    await user.click(
      screen.getByRole("button", { name: "Save & choose publishing method" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Publish Contact us" }),
    ).toBeVisible();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/forms/admin",
      expect.objectContaining({
        name: "Contact us",
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "email", leadField: "email" }),
        ]),
      }),
    );
  });
  it("separates hosted link, embed, and developer API instructions", async () => {
    const user = userEvent.setup();
    app("/forms?publish=form-1");
    expect(
      await screen.findByRole("button", { name: "Copy link" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Embed on website" }));
    expect(
      await screen.findByDisplayValue('<iframe title="Contact us"></iframe>'),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Connect your own form" }),
    );
    expect(
      (screen.getByLabelText("Integration code") as HTMLTextAreaElement).value,
    ).toContain("/api/v1/forms/form-1/submit");
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it("does not present a load failure as an empty collection", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error("offline"));
    app("/forms");
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Start with a form that is ready to customise"),
    ).not.toBeInTheDocument();
  });
  it("preserves an existing public address when renaming a form", async () => {
    const user = userEvent.setup();
    app("/forms/form-1/edit");
    const name = await screen.findByLabelText("Form Name *");
    await waitFor(() => expect(name).toHaveValue("Contact us"));
    await user.clear(name);
    await user.type(name, "New contact form");
    expect(screen.getByLabelText("URL Slug")).toHaveValue("contact-us");
  });
  it("shows public field errors and blocks unchecked consent", async () => {
    const user = userEvent.setup();
    app("/forms/contact-us");
    await user.click(await screen.findByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Full name is required")).toBeVisible();
    await user.type(screen.getByLabelText(/Full name/), "Visitor");
    await user.type(
      screen.getByLabelText(/Email address/),
      "visitor@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(
      await screen.findByText("I agree to be contacted must be checked"),
    ).toBeVisible();
    expect(apiClient.post).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("I agree to be contacted"));
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, data: { message: "Thanks!" } },
    });
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(
      await screen.findByRole("heading", { name: "Submission received" }),
    ).toBeVisible();
  });
  it("keeps public answers when a submission fails", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockRejectedValue(
      new Error("temporarily unavailable"),
    );
    app("/forms/contact-us");
    await user.type(await screen.findByLabelText(/Full name/), "Visitor");
    await user.type(
      screen.getByLabelText(/Email address/),
      "visitor@example.com",
    );
    await user.click(screen.getByLabelText("I agree to be contacted"));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByLabelText(/Full name/)).toHaveValue("Visitor");
  });
});
