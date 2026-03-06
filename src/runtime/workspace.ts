import { mkdir } from "node:fs/promises";
import path from "node:path";

export async function ensureWorkspaceDirectories(workspaceDir: string): Promise<void> {
  await Promise.all(
    [workspaceDir, path.join(workspaceDir, "state"), path.join(workspaceDir, "logs")].map(
      (directory) => mkdir(directory, { recursive: true }),
    ),
  );
}
