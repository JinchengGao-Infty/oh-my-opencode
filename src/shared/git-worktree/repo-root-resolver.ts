import { runGitOrThrow } from "./run-git"

export function resolveRepoRoot(directory: string): string {
  const root = runGitOrThrow(["rev-parse", "--show-toplevel"], {
    cwd: directory,
    timeoutMs: 5000,
  }).trim()

  if (!root) {
    throw new Error(`Unable to resolve git repo root for directory: ${directory}`)
  }

  return root
}
