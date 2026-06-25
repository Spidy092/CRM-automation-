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

const files = fs.readdirSync(apiDir).filter(f => f.endsWith('.ts') && f !== 'client.ts');

files.forEach(file => {
  const name = file.replace('.ts', '');
  const testFile = path.join(testDir, `${name}.test.ts`);
  
  const content = `import { describe, it, expect, vi } from 'vitest';
import * as api from '../${name}';

vi.mock('../client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: [] } }),
    post: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    put: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    patch: vi.fn().mockResolvedValue({ data: { success: true, data: {} } })
  }
}));

describe('${name} API', () => {
  it('should be defined', () => {
    expect(api).toBeDefined();
    // basic sanity check
    expect(Object.keys(api).length).toBeGreaterThan(0);
  });
});
`;

  fs.writeFileSync(testFile, content);
  console.log(`Created ${testFile}`);
});
