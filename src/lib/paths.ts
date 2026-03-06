import os from "node:os";
import path from "node:path";

export function resolveWorkspaceDir(env: Record<string, string | undefined>) {
  return env.CODEX_WORKSPACE_DIR ?? path.join(os.homedir(), ".codex-claw", "workspace");
}
