import { runGit } from "./run-git"

export function removeAgentWorktree(input: {
  repoRoot: string
  path: string
  branch?: string
}): void {
  // Best-effort cleanup.
  runGit(["worktree", "remove", "--force", input.path], {
    cwd: input.repoRoot,
    timeoutMs: 60_000,
  })

  if (!input.branch) return

  runGit(["branch", "-D", input.branch], {
    cwd: input.repoRoot,
    timeoutMs: 10_000,
  })
}
