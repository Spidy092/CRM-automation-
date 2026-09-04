type AsyncCleanup = () => void | Promise<void>;

interface ProcessWithTestCleanups extends NodeJS.Process {
  __crmTestCleanups?: Set<AsyncCleanup>;
}

const processWithTestCleanups = process as ProcessWithTestCleanups;
const cleanups = (processWithTestCleanups.__crmTestCleanups ??= new Set<AsyncCleanup>());

export function registerTestCleanup(cleanup: AsyncCleanup): void {
  if (process.env.NODE_ENV === 'test') cleanups.add(cleanup);
}

export async function cleanupTestResources(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') return;
  const pending = [...cleanups];
  cleanups.clear();
  for (const cleanup of pending) {
    try {
      await cleanup();
    } catch {
      continue;
    }
  }
}
