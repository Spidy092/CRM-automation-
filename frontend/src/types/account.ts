import type { UserRole } from './index';

export type AccountTab = 'profile' | 'security' | 'preferences' | 'permissions' | 'apikeys';
export type Theme = 'light' | 'dark' | 'system';
export type DefaultView = 'board' | 'list';

export interface Preferences {
  theme: Theme;
  notificationSound: boolean;
  defaultPipelineView: DefaultView;
  compactMode: boolean;
}

export const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800',
  manager: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800',
  sales: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
  marketing: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
  viewer: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

/**
 * Standard RBAC Permission Matrix per role derived from system security rules.
 */
export const ROLE_PERMISSIONS: Record<
  UserRole,
  Record<string, { read: boolean; write: boolean; admin: boolean }>
> = {
  admin: {
    Leads: { read: true, write: true, admin: true },
    Campaigns: { read: true, write: true, admin: true },
    Pipeline: { read: true, write: true, admin: true },
    Templates: { read: true, write: true, admin: true },
    Reports: { read: true, write: true, admin: true },
    'User Mgmt': { read: true, write: true, admin: true },
    Settings: { read: true, write: true, admin: true },
    Integrations: { read: true, write: true, admin: true },
  },
  manager: {
    Leads: { read: true, write: true, admin: false },
    Campaigns: { read: true, write: true, admin: false },
    Pipeline: { read: true, write: true, admin: false },
    Templates: { read: true, write: true, admin: false },
    Reports: { read: true, write: true, admin: false },
    'User Mgmt': { read: true, write: false, admin: false },
    Settings: { read: false, write: false, admin: false },
    Integrations: { read: false, write: false, admin: false },
  },
  sales: {
    Leads: { read: true, write: true, admin: false },
    Campaigns: { read: true, write: false, admin: false },
    Pipeline: { read: true, write: true, admin: false },
    Templates: { read: true, write: false, admin: false },
    Reports: { read: true, write: false, admin: false },
    'User Mgmt': { read: false, write: false, admin: false },
    Settings: { read: false, write: false, admin: false },
    Integrations: { read: false, write: false, admin: false },
  },
  marketing: {
    Leads: { read: true, write: false, admin: false },
    Campaigns: { read: true, write: true, admin: false },
    Pipeline: { read: true, write: false, admin: false },
    Templates: { read: true, write: true, admin: false },
    Reports: { read: true, write: true, admin: false },
    'User Mgmt': { read: false, write: false, admin: false },
    Settings: { read: false, write: false, admin: false },
    Integrations: { read: false, write: false, admin: false },
  },
  viewer: {
    Leads: { read: true, write: false, admin: false },
    Campaigns: { read: true, write: false, admin: false },
    Pipeline: { read: true, write: false, admin: false },
    Templates: { read: true, write: false, admin: false },
    Reports: { read: true, write: false, admin: false },
    'User Mgmt': { read: false, write: false, admin: false },
    Settings: { read: false, write: false, admin: false },
    Integrations: { read: false, write: false, admin: false },
  },
};
