import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { type ReactNode } from "react";
import {
  useCreateWorkflow,
  usePauseWorkflow,
  usePublishWorkflow,
  useResumeWorkflow,
  useValidateWorkflow,
  useWorkflow,
  useWorkflows,
  type WorkflowDefinition,
  type WorkflowDetail,
} from "../workflows";
import { apiClient } from "../client";

vi.mock("../client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const workflowDefinition: WorkflowDefinition = {
  name: "New lead follow-up",
  description: "Route and contact new leads",
  entryNodeId: "trigger",
  nodes: [
    {
      id: "trigger",
      type: "trigger",
      next: ["end"],
      trigger: { event: "lead.created" },
    },
    { id: "end", type: "end", next: [] },
  ],
};

const workflow: WorkflowDetail = {
  id: "workflow-1",
  name: "New lead follow-up",
  description: "Route and contact new leads",
  status: "draft",
  created_by: "user-1",
  created_at: "2026-09-07T00:00:00.000Z",
  updated_at: "2026-09-07T00:00:00.000Z",
  deleted_at: null,
  current_version: {
    id: "version-1",
    workflow_id: "workflow-1",
    version: 1,
    definition: workflowDefinition,
    status: "draft",
    created_by: "user-1",
    published_at: null,
    created_at: "2026-09-07T00:00:00.000Z",
  },
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe("workflows API hooks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("lists workflows using the standard response envelope", async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: { success: true, data: [workflow] },
    });

    const { result } = renderHook(() => useWorkflows(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.get).toHaveBeenCalledWith("/workflows");
    expect(result.current.data).toEqual([workflow]);
  });

  it("does not fetch an empty workflow id", () => {
    const { result } = renderHook(() => useWorkflow(""), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("gets a workflow by id", async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: { success: true, data: workflow },
    });

    const { result } = renderHook(() => useWorkflow("workflow-1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.get).toHaveBeenCalledWith("/workflows/workflow-1");
    expect(result.current.data?.current_version?.definition.entryNodeId).toBe(
      "trigger",
    );
  });

  it("creates a workflow and invalidates the workflow list", async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: { success: true, data: workflow },
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateWorkflow(), { wrapper });
    await result.current.mutateAsync({
      name: workflow.name,
      description: workflow.description,
      definition: workflowDefinition,
    });

    expect(apiClient.post).toHaveBeenCalledWith("/workflows", {
      name: workflow.name,
      description: workflow.description,
      definition: workflowDefinition,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["workflows"] });
  });

  it.each([
    [
      "publishes",
      usePublishWorkflow,
      "/workflows/workflow-1/publish",
      "published",
    ],
    ["pauses", usePauseWorkflow, "/workflows/workflow-1/pause", "paused"],
    ["resumes", useResumeWorkflow, "/workflows/workflow-1/resume", "published"],
  ] as const)(
    "%s a workflow and invalidates list/detail queries",
    async (_label, useAction, path, status) => {
      const updatedWorkflow = { ...workflow, status } as WorkflowDetail;
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { success: true, data: updatedWorkflow },
      });
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useAction(), { wrapper });
      await result.current.mutateAsync("workflow-1");

      expect(apiClient.post).toHaveBeenCalledWith(path);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["workflows"] });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["workflows", "workflow-1"],
      });
    },
  );

  it("validates a definition without invalidating persisted workflow queries", async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: { success: true, data: { valid: true, issues: [] } },
    });

    const { result } = renderHook(() => useValidateWorkflow(), {
      wrapper: createWrapper(),
    });
    const validation = await result.current.mutateAsync(workflowDefinition);

    expect(apiClient.post).toHaveBeenCalledWith(
      "/workflows/validate",
      workflowDefinition,
    );
    expect(validation).toEqual({ valid: true, issues: [] });
  });
});
