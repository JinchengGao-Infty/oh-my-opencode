import { spawnSync } from "node:child_process"

export interface RunGitOptions {
  cwd: string
  timeoutMs?: number
}

export interface RunGitResult {
  exitCode: number
  stdout: string
  stderr: string
}

export function runGit(args: string[], options: RunGitOptions): RunGitResult {
  const proc = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf-8",
    timeout: options.timeoutMs,
  })

  const exitCode = typeof proc.status === "number" ? proc.status : 1

  return {
    exitCode,
    stdout: proc.stdout?.trimEnd() ?? "",
    stderr: proc.stderr?.trimEnd() ?? "",
  }
}

export function runGitOrThrow(args: string[], options: RunGitOptions): string {
  const result = runGit(args, options)
  if (result.exitCode !== 0) {
    const suffix = result.stderr ? `\n${result.stderr}` : ""
    throw new Error(`git ${args.join(" ")} failed (exit ${result.exitCode})${suffix}`)
  }
  return result.stdout
}

export function tryRunGit(args: string[], options: RunGitOptions): string | null {
  try {
    return runGitOrThrow(args, options)
  } catch {
    return null
  }
}
