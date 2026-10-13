import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';

export type AssignmentRole = 'admin' | 'manager' | 'sales' | 'marketing' | 'viewer';

export interface AssignmentConfig {
  id: string;
  is_enabled: boolean;
  threshold_score: number;
  eligible_roles: AssignmentRole[];
  updated_at: string;
}

export interface EligibleUser {
  id: string;
  name: string;
  email: string;
  role: AssignmentRole;
  is_available: boolean;
  last_assigned_at: string | null;
  assignment_count: number;
}

export interface LeadAssignment {
  id: string;
  lead_id: string;
  assigned_to: string;
  assigned_by: string | null;
  assignment_type: 'round_robin' | 'manual' | 'override';
  created_at: string;
}

export interface ManualAssignmentInput {
  lead_id: string;
  user_id: string;
}

export interface OverrideAssignmentInput {
  lead_id: string;
  new_user_id: string;
  reason: string;
}

export interface UpdateAssignmentConfigInput {
  is_enabled?: boolean;
  threshold_score?: number;
  eligible_roles?: string[];
}

// Config Hooks
export function useAssignmentConfig() {
  return useQuery({
    queryKey: ['assignments-config'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<AssignmentConfig>>('/assignments/config');
      return response.data.data;
    },
  });
}

export function useUpdateAssignmentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateAssignmentConfigInput) => {
      const response = await apiClient.put<ApiResponse<AssignmentConfig>>('/assignments/config', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignments-config'] });
    },
  });
}

// Users Hook
export function useEligibleUsers() {
  return useQuery({
    queryKey: ['assignments-eligible-users'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<EligibleUser[]>>('/assignments/eligible-users');
      return response.data.data;
    },
  });
}

export function useUserAssignments(userId: string) {
  return useQuery({
    queryKey: ['assignments-user', userId],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<LeadAssignment[]>>(`/assignments/user/${userId}`);
      return response.data.data;
    },
    enabled: !!userId,
  });
}

// Assignment Actions
export function useManualAssign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ManualAssignmentInput) => {
      const response = await apiClient.post<ApiResponse<LeadAssignment>>('/assignments/manual', input);
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', variables.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['assignments-user'] });
    },
  });
}

export function useOverrideAssign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: OverrideAssignmentInput) => {
      const response = await apiClient.post<ApiResponse<LeadAssignment>>('/assignments/override', input);
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', variables.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['assignments-user'] });
    },
  });
}
