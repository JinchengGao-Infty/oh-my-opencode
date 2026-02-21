import { mkdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { resolveRepoRoot } from "./repo-root-resolver"
import { resolveBaseRef } from "./base-ref-resolver"
import { runGit, runGitOrThrow } from "./run-git"
import { sanitizeRefComponent } from "./sanitize-ref-component"
import { findWorktreePathForBranch } from "./worktree-list"

export interface AgentWorktreeInfo {
  repoRoot: string
  path: string
  branch: string
  baseRef: string
}

export function createAgentWorktree(input: {
  directory: string
  agent: string
  runId: string
}): AgentWorktreeInfo {
  const repoRoot = resolveRepoRoot(input.directory)
  const baseRef = resolveBaseRef(input.directory, repoRoot)

  const agentSeg = sanitizeRefComponent(input.agent)
  const runSeg = sanitizeRefComponent(input.runId)
  const branch = `agent/${agentSeg}/${runSeg}`

  const worktreePath = join(repoRoot, ".sisyphus", "worktrees", agentSeg, runSeg)
  const parentDir = dirname(worktreePath)
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true })
  }

  // If a prior run crashed, the branch may still exist (and may still be linked to a worktree).
  // Clean it up so worktree creation is idempotent.
  const ref = `refs/heads/${branch}`
  const exists = runGit(["show-ref", "--verify", "--quiet", ref], {
    cwd: repoRoot,
    timeoutMs: 5000,
  }).exitCode === 0

  if (exists) {
    const existingWorktreePath = findWorktreePathForBranch(repoRoot, branch)
    if (existingWorktreePath) {
      runGit(["worktree", "remove", "--force", existingWorktreePath], {
        cwd: repoRoot,
        timeoutMs: 60_000,
      })
    }

    runGitOrThrow(["branch", "-D", branch], {
      cwd: repoRoot,
      timeoutMs: 10_000,
    })
  }

  runGitOrThrow(["worktree", "add", worktreePath, "-b", branch, baseRef], {
    cwd: repoRoot,
    timeoutMs: 60_000,
  })

  return {
    repoRoot,
    path: worktreePath,
    branch,
    baseRef,
  }
}
