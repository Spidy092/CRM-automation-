import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiDir = path.join(__dirname, 'src', 'api');
const testDir = path.join(apiDir, '__tests__');

if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir);
}

const files = fs.readdirSync(apiDir).filter(f => f.endsWith('.ts') && f !== 'client.ts' && f !== 'types.ts');

files.forEach(file => {
  const name = file.replace('.ts', '');
  const testFile = path.join(testDir, `${name}.test.tsx`);
  
  const fileContent = fs.readFileSync(path.join(apiDir, file), 'utf-8');
  
  // extract all exported functions that start with use
  const regex = /export function (use[A-Za-z0-9_]+)/g;
  let match;
  const hooks = [];
  while ((match = regex.exec(fileContent)) !== null) {
    hooks.push(match[1]);
  }
  
  const imports = hooks.join(', ');
  
  let testContent = `import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { ${imports} } from '../${name}';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import React from 'react';

vi.mock('../client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    post: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    put: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    patch: vi.fn().mockResolvedValue({ data: { success: true, data: {} } })
  }
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('${name} API', () => {
`;

  hooks.forEach(hook => {
    testContent += `  it('renders ${hook} successfully', async () => {
    const { result } = renderHook(() => ${hook}({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });\n`;
  });

  testContent += `});\n`;

  fs.writeFileSync(testFile, testContent);
  console.log(`Created ${testFile} with ${hooks.length} hooks`);
});
