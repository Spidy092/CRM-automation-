import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';

export const leadGroupNameSchema = z.object({ name: z.string().trim().min(1, 'Enter a group name.').max(60) });
const groupSchema = z.object({ id: z.string(), name: z.string().max(60), filters: z.string() });
const savedSchema = z.object({ groups: z.record(z.array(groupSchema).max(50)) });
const FILTER_KEYS = ['tab', 'status', 'classification', 'dateRange', 'pipeline', 'q', 'tag'];

export function leadGroupFilters(params: URLSearchParams): string {
  const filtered = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filtered.set(key, value);
  }
  return filtered.toString();
}

interface LeadGroupsState {
  groups: Record<string, z.infer<typeof groupSchema>[]>;
  save: (userId: string, name: string, filters: string) => void;
  remove: (userId: string, id: string) => void;
}

export const useLeadGroupsStore = create<LeadGroupsState>()(persist((set, get) => {
  // Zustand persists after updating memory. Restore memory if storage rejects a write.
  const updateGroups = (groups: LeadGroupsState['groups']): void => {
    const previous = get().groups;
    try {
      set({ groups });
    } catch (error) {
      try { set({ groups: previous }); } catch { /* Memory is restored before persistence retries. */ }
      throw error;
    }
  };
  return {
    groups: {},
    save: (userId, name, filters) => {
      const groups = get().groups;
      updateGroups({ ...groups, [userId]: [...(groups[userId] ?? []), { id: crypto.randomUUID(), name, filters }] });
    },
    remove: (userId, id) => {
      const groups = get().groups;
      updateGroups({ ...groups, [userId]: (groups[userId] ?? []).filter((group) => group.id !== id) });
    },
  };
}, {
  name: 'crm.lead-groups',
  storage: createJSONStorage(() => ({
    getItem: (name) => localStorage.getItem(name),
    setItem: (name, value) => localStorage.setItem(name, value),
    removeItem: (name) => localStorage.removeItem(name),
  })),
  merge: (persisted, current) => {
    const parsed = savedSchema.safeParse(persisted);
    return parsed.success ? { ...current, groups: parsed.data.groups } : current;
  },
}));
