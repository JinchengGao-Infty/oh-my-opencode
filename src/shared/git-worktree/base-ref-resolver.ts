import { tryRunGit } from "./run-git"

function branchExists(repoRoot: string, branch: string): boolean {
  const ref = `refs/heads/${branch}`
  const out = tryRunGit(["show-ref", "--verify", "--quiet", ref], {
    cwd: repoRoot,
    timeoutMs: 5000,
  })
  // show-ref --quiet prints nothing; success is inferred by non-null.
  return out !== null
}

/**
 * Resolve the base ref used to create agent worktrees.
 *
 * Priority:
 * 1) current branch name (if not detached)
 * 2) main/master (if present)
 * 3) HEAD commit SHA
 */
export function resolveBaseRef(directory: string, repoRoot: string): string {
  const headRef = tryRunGit(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: directory,
    timeoutMs: 5000,
  })

  if (headRef && headRef !== "HEAD") {
    return headRef.trim()
  }

  if (branchExists(repoRoot, "main")) return "main"
  if (branchExists(repoRoot, "master")) return "master"

  const sha = tryRunGit(["rev-parse", "HEAD"], { cwd: directory, timeoutMs: 5000 })
  if (sha) return sha.trim()

  throw new Error(`Unable to resolve base ref for directory: ${directory}`)
}
