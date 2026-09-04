import { afterAll } from "@jest/globals";
import { Socket } from "node:net";
import { cleanupTestResources } from "./src/shared/utils/testResources";

function closeLocalTestSockets(): void {
  const processWithHandles = process as NodeJS.Process & { _getActiveHandles?: () => unknown[] };
  for (const handle of processWithHandles._getActiveHandles?.() ?? []) {
    if (!(handle instanceof Socket)) continue;
    if (handle.remoteAddress !== "127.0.0.1") continue;
    if (handle.remotePort !== 5432 && handle.remotePort !== 6379) continue;
    handle.destroy();
  }
}

afterAll(async () => {
  await cleanupTestResources();
  closeLocalTestSockets();
});
