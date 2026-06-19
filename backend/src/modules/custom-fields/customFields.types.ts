import { CustomFieldType } from '../../shared/types';

export interface CustomFieldDefinition {
  id: string;
  label: string;
  field_key: string;
  field_type: CustomFieldType;
  options: string[] | null;
  is_required: boolean;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CustomFieldInput {
  label: string;
  field_key: string;
  field_type: CustomFieldType;
  options?: string[] | null;
  is_required?: boolean;
  is_active?: boolean;
}

export interface CustomFieldValidationResult {
  valid: boolean;
  errors: string[];
  sanitized: Record<string, unknown>;
}
