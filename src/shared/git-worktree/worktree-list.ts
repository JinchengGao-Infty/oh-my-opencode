import { runGitOrThrow } from "./run-git"

export interface ListedWorktree {
  path: string
  head?: string
  branch?: string
  detached?: boolean
}

export function listGitWorktrees(repoRoot: string): ListedWorktree[] {
  const out = runGitOrThrow(["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
    timeoutMs: 10_000,
  })

  const blocks: ListedWorktree[] = []
  let current: ListedWorktree | null = null

  for (const rawLine of out.split("\n")) {
    const line = rawLine.trimEnd()
    if (!line) {
      if (current?.path) {
        blocks.push(current)
      }
      current = null
      continue
    }

    if (!current) {
      current = { path: "" }
    }

    if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length).trim()
      continue
    }
    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim()
      continue
    }
    if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).trim()
      continue
    }
    if (line === "detached") {
      current.detached = true
      continue
    }
  }

  if (current?.path) {
    blocks.push(current)
  }

  return blocks
}

export function findWorktreePathForBranch(repoRoot: string, branchName: string): string | null {
  const want = `refs/heads/${branchName}`
  const list = listGitWorktrees(repoRoot)
  return list.find((wt) => wt.branch === want)?.path ?? null
}
