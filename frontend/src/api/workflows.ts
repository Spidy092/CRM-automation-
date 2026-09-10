import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, type ApiResponse } from "./client";

// Keep this contract in lockstep with backend/src/modules/workflows/workflow.types.ts.
// Workflows are currently persisted as versioned definitions, so consumers should
// use `current_version.definition` rather than assuming the root row has a graph.
export type WorkflowNodeType =
  "trigger" | "condition" | "action" | "wait" | "goal" | "end";

export type WorkflowTriggerType =
  | "lead.created"
  | "lead.updated"
  | "lead.stage_changed"
  | "lead.tag_added"
  | "form.submitted"
  | "message.event"
  | "booking.created"
  | "booking.cancelled"
  | "webhook.received"
  | "schedule.reached";

export type WorkflowActionType =
  | "lead.update"
  | "lead.add_tag"
  | "lead.remove_tag"
  | "lead.assign"
  | "pipeline.move"
  | "task.create"
  | "message.send"
  | "sequence.enroll"
  | "notification.send"
  | "webhook.call";

export type WorkflowComparisonOperator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "exists";

export type WorkflowScalar = string | number | boolean | null;

export interface WorkflowFieldCondition {
  field: string;
  operator: WorkflowComparisonOperator;
  value?: WorkflowScalar | WorkflowScalar[];
}

export type WorkflowCondition =
  | WorkflowFieldCondition
  | { all: WorkflowCondition[] }
  | { any: WorkflowCondition[] }
  | { not: WorkflowCondition };

export interface WorkflowTriggerConfig {
  event: WorkflowTriggerType;
  filters?: WorkflowCondition;
}

export interface WorkflowActionConfig {
  type: WorkflowActionType;
  input: Record<string, WorkflowScalar | WorkflowScalar[]>;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  next: string[];
  branches?: { true: string; false: string };
  trigger?: WorkflowTriggerConfig;
  condition?: WorkflowCondition;
  action?: WorkflowActionConfig;
  waitMinutes?: number;
  goal?: WorkflowCondition;
}

export interface WorkflowDefinition {
  id?: string;
  name: string;
  description?: string | null;
  entryNodeId: string;
  nodes: WorkflowNode[];
}

export interface WorkflowValidationIssue {
  path: string;
  message: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
}

export type WorkflowStatus = "draft" | "published" | "paused" | "archived";
export type WorkflowVersionStatus = "draft" | "published" | "retired";

export interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface WorkflowVersionRow {
  id: string;
  workflow_id: string;
  version: number;
  definition: WorkflowDefinition;
  status: WorkflowVersionStatus;
  created_by: string;
  published_at: string | null;
  created_at: string;
}

export interface WorkflowDetail extends WorkflowRow {
  current_version: WorkflowVersionRow | null;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string | null;
  definition: WorkflowDefinition;
}

export function useWorkflows() {
  return useQuery({
    queryKey: ["workflows"],
    queryFn: async (): Promise<WorkflowDetail[]> => {
      const response =
        await apiClient.get<ApiResponse<WorkflowDetail[]>>("/workflows");
      return response.data.data;
    },
  });
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: ["workflows", id],
    queryFn: async (): Promise<WorkflowDetail> => {
      const response = await apiClient.get<ApiResponse<WorkflowDetail>>(
        `/workflows/${id}`,
      );
      return response.data.data;
    },
    enabled: Boolean(id),
  });
}

function invalidateWorkflowQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
): void {
  queryClient.invalidateQueries({ queryKey: ["workflows"] });
  queryClient.invalidateQueries({ queryKey: ["workflows", id] });
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateWorkflowInput): Promise<WorkflowDetail> => {
      const response = await apiClient.post<ApiResponse<WorkflowDetail>>(
        "/workflows",
        input,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}

export function usePublishWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<WorkflowDetail> => {
      const response = await apiClient.post<ApiResponse<WorkflowDetail>>(
        `/workflows/${id}/publish`,
      );
      return response.data.data;
    },
    onSuccess: (workflow) => {
      invalidateWorkflowQueries(queryClient, workflow.id);
    },
  });
}

export function usePauseWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<WorkflowDetail> => {
      const response = await apiClient.post<ApiResponse<WorkflowDetail>>(
        `/workflows/${id}/pause`,
      );
      return response.data.data;
    },
    onSuccess: (workflow) => {
      invalidateWorkflowQueries(queryClient, workflow.id);
    },
  });
}

export function useResumeWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<WorkflowDetail> => {
      const response = await apiClient.post<ApiResponse<WorkflowDetail>>(
        `/workflows/${id}/resume`,
      );
      return response.data.data;
    },
    onSuccess: (workflow) => {
      invalidateWorkflowQueries(queryClient, workflow.id);
    },
  });
}

export function useValidateWorkflow() {
  return useMutation({
    mutationFn: async (
      definition: WorkflowDefinition,
    ): Promise<WorkflowValidationResult> => {
      const response = await apiClient.post<
        ApiResponse<WorkflowValidationResult>
      >("/workflows/validate", definition);
      return response.data.data;
    },
  });
}
