import os from "node:os";
import path from "node:path";

export function resolveWorkspaceDir(env: Record<string, string | undefined>) {
  const workspaceDir = env.CODEX_WORKSPACE_DIR?.trim();

  if (workspaceDir) {
    return path.resolve(workspaceDir);
  }

  return path.join(os.homedir(), ".codex-claw", "workspace");
}
