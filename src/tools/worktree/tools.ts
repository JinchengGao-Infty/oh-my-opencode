import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  findWorktreePathForBranch,
  log,
  removeAgentWorktree,
  resolveRepoRoot,
  runGit,
  runGitOrThrow,
  sanitizeRefComponent,
} from "../../shared"
import { deleteWorktreeRun, readWorktreeRun } from "../../features/worktree-registry"

type DiffFormat = "summary" | "patch"

const MAX_PATCH_BYTES = 50 * 1024

function formatBlock(title: string, body: string): string {
  const content = body.trimEnd()
  return content ? `## ${title}\n${content}` : `## ${title}\n(none)`
}

function ensureParentDir(path: string): void {
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function createWorktreeTools(ctx: PluginInput): Record<string, ToolDefinition> {
  const worktree_diff: ToolDefinition = tool({
    description:
      "Show git diff for a background task worktree. " +
      "Reads .sisyphus/worktrees/runs/<task_id>.json to locate the linked worktree and branch.",
    args: {
      task_id: tool.schema.string().describe("Background task ID (e.g. bg_ab12cd34)"),
      format: tool.schema.enum(["summary", "patch"]).optional().describe("summary=name/status+stats, patch=full diff"),
    },
    execute: async (args) => {
      const repoRoot = resolveRepoRoot(ctx.directory)
      const run = readWorktreeRun(repoRoot, args.task_id)
      if (!run) {
        return `Worktree run not found for task_id=${args.task_id}.\nLooked under: ${join(repoRoot, ".sisyphus", "worktrees", "runs")}`
      }

      const worktreePath = run.worktree.path
      if (!existsSync(worktreePath)) {
        return `Worktree path does not exist: ${worktreePath}`
      }

      const mergeBase = runGitOrThrow(["merge-base", run.worktree.baseRef, run.worktree.branch], {
        cwd: repoRoot,
        timeoutMs: 10_000,
      }).trim()

      const format = (args.format ?? "summary") as DiffFormat
      const status = runGitOrThrow(["status", "--porcelain"], { cwd: worktreePath, timeoutMs: 10_000 })
      const untracked = runGitOrThrow(["ls-files", "--others", "--exclude-standard"], {
        cwd: worktreePath,
        timeoutMs: 10_000,
      })

      const header = [
        "# Worktree Diff",
        `- task_id: ${run.id}`,
        `- agent: ${run.agent}`,
        `- description: ${run.description}`,
        `- worktree: ${run.worktree.path}`,
        `- branch: ${run.worktree.branch}`,
        `- baseRef: ${run.worktree.baseRef}`,
        `- mergeBase: ${mergeBase}`,
      ].join("\n")

      if (format === "patch") {
        const diff = runGitOrThrow(["diff", mergeBase], { cwd: worktreePath, timeoutMs: 120_000 })

        const bytes = Buffer.byteLength(diff, "utf-8")
        if (bytes > MAX_PATCH_BYTES) {
          const nameStatus = runGitOrThrow(["diff", "--name-status", mergeBase], {
            cwd: worktreePath,
            timeoutMs: 30_000,
          })
          const numstat = runGitOrThrow(["diff", "--numstat", mergeBase], {
            cwd: worktreePath,
            timeoutMs: 30_000,
          })

          const kb = Math.round(bytes / 1024)
          const hint = `Patch too large (${kb}KB). Showing summary only.\nManual diff: git -C "${worktreePath}" diff ${mergeBase}`

          return [
            header,
            "",
            formatBlock("Status", status),
            "",
            formatBlock("Changed Files", nameStatus),
            "",
            formatBlock("Stats", numstat),
            "",
            formatBlock("Untracked", untracked),
            "",
            hint,
          ].join("\n")
        }

        return [
          header,
          "",
          formatBlock("Status", status),
          "",
          formatBlock("Untracked", untracked),
          "",
          formatBlock("Patch", diff),
        ].join("\n")
      }

      const nameStatus = runGitOrThrow(["diff", "--name-status", mergeBase], {
        cwd: worktreePath,
        timeoutMs: 30_000,
      })
      const numstat = runGitOrThrow(["diff", "--numstat", mergeBase], {
        cwd: worktreePath,
        timeoutMs: 30_000,
      })

      return [
        header,
        "",
        formatBlock("Status", status),
        "",
        formatBlock("Changed Files", nameStatus),
        "",
        formatBlock("Stats", numstat),
        "",
        formatBlock("Untracked", untracked),
      ].join("\n")
    },
  })

  const worktree_merge: ToolDefinition = tool({
    description:
      "Merge a background task worktree branch back into the base branch. " +
      "Requires a clean target worktree. Can auto-commit uncommitted changes in the agent worktree.",
    args: {
      task_id: tool.schema.string().describe("Background task ID (e.g. bg_ab12cd34)"),
      target_branch: tool.schema.string().optional().describe("Branch to merge into (default: current HEAD branch). WARNING: merging into non-HEAD requires confirm_other_branch=true."),
      confirm_other_branch: tool.schema.boolean().optional().describe("Set true to merge into a branch other than current HEAD (default: false)"),
      squash: tool.schema.boolean().optional().describe("Use squash merge (default: false)") ,
      auto_commit: tool.schema.boolean().optional().describe("Auto-commit uncommitted changes in agent worktree (default: true)"),
      cleanup: tool.schema.boolean().optional().describe("Remove agent worktree + delete agent branch + delete run record (default: true)"),
    },
    execute: async (args) => {
      const repoRoot = resolveRepoRoot(ctx.directory)
      const run = readWorktreeRun(repoRoot, args.task_id)
      if (!run) {
        return `Worktree run not found for task_id=${args.task_id}.`
      }

      const agentWorktree = run.worktree.path
      const agentBranch = run.worktree.branch
      const currentHead = runGitOrThrow(["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repoRoot,
        timeoutMs: 10_000,
      }).trim()

      if (currentHead === "HEAD") {
        return "Refusing to merge while repo is in detached HEAD. Specify target_branch explicitly and rerun."
      }

      const targetBranchRaw = args.target_branch?.trim()
      const targetBranch = targetBranchRaw || currentHead
      const confirmOtherBranch = args.confirm_other_branch === true

      // Safety: if the user's HEAD moved since worktree creation, do not guess.
      if (!targetBranchRaw && run.worktree.baseRef && run.worktree.baseRef !== currentHead) {
        return [
          "Refusing to merge without explicit target_branch because HEAD changed since this worktree was created.",
          `- current_head: ${currentHead}`,
          `- recorded_baseRef: ${run.worktree.baseRef}`,
          "",
          `If you want to merge into current_head, rerun with target_branch=\"${currentHead}\".`,
          `If you want to merge into recorded_baseRef, rerun with target_branch=\"${run.worktree.baseRef}\" confirm_other_branch=true.`,
        ].join("\n")
      }

      if (targetBranchRaw && targetBranch !== currentHead && !confirmOtherBranch) {
        return [
          "Refusing to merge into a non-HEAD branch by default.",
          `- current_head: ${currentHead}`,
          `- target_branch: ${targetBranch}`,
          `- recorded_baseRef: ${run.worktree.baseRef}`,
          "",
          "If you really want to merge into target_branch, rerun with confirm_other_branch=true.",
        ].join("\n")
      }
      const squash = args.squash === true
      const autoCommit = args.auto_commit !== false
      const cleanup = args.cleanup !== false

      if (!existsSync(agentWorktree)) {
        return `Agent worktree path does not exist: ${agentWorktree}`
      }

      let targetWorktree = findWorktreePathForBranch(repoRoot, targetBranch)
      let createdTargetWorktree = false

      if (!targetWorktree) {
        const safe = sanitizeRefComponent(targetBranch)
        const tmp = join(repoRoot, ".sisyphus", "worktrees", "_merge", `${safe}-${Date.now()}`)
        ensureParentDir(tmp)
        const addRes = runGit(["worktree", "add", tmp, targetBranch], { cwd: repoRoot, timeoutMs: 60_000 })
        if (addRes.exitCode !== 0) {
          return `Failed to create target worktree for branch '${targetBranch}'.\n${addRes.stderr || addRes.stdout}`
        }
        targetWorktree = tmp
        createdTargetWorktree = true
      }

      try {
        const targetHead = runGitOrThrow(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: targetWorktree, timeoutMs: 10_000 })
        if (targetHead.trim() !== targetBranch) {
          return `Target worktree is on '${targetHead.trim()}', expected '${targetBranch}'. Target path: ${targetWorktree}`
        }

        const targetStatus = runGitOrThrow(["status", "--porcelain"], { cwd: targetWorktree, timeoutMs: 10_000 })
        if (targetStatus.trim().length > 0) {
          return `Target worktree is dirty; aborting merge.\nPath: ${targetWorktree}\n\n${targetStatus.trimEnd()}`
        }

        const agentStatus = runGitOrThrow(["status", "--porcelain"], { cwd: agentWorktree, timeoutMs: 10_000 })
        if (agentStatus.trim().length > 0) {
          if (!autoCommit) {
            return `Agent worktree has uncommitted changes; set auto_commit=true or commit manually.\nPath: ${agentWorktree}\n\n${agentStatus.trimEnd()}`
          }

          runGitOrThrow(["add", "-A"], { cwd: agentWorktree, timeoutMs: 60_000 })
          const msg = `Hydra: ${run.id} (${run.agent})`
          const commitRes = runGit(["commit", "-m", msg], { cwd: agentWorktree, timeoutMs: 120_000 })
          if (commitRes.exitCode !== 0) {
            return `Auto-commit failed in agent worktree.\n${commitRes.stderr || commitRes.stdout}`
          }
        }

        const mergeRes = squash
          ? runGit(["merge", "--squash", agentBranch], { cwd: targetWorktree, timeoutMs: 600_000 })
          : runGit(["merge", "--no-ff", "--no-edit", agentBranch], { cwd: targetWorktree, timeoutMs: 600_000 })

        if (mergeRes.exitCode !== 0) {
          runGit(["merge", "--abort"], { cwd: targetWorktree, timeoutMs: 60_000 })
          return `Merge failed (conflict likely). Merge aborted.\n${mergeRes.stderr || mergeRes.stdout}`
        }

        if (squash) {
          const squashMsg = `Hydra: merge ${agentBranch} into ${targetBranch} (squash)`
          const squashCommit = runGit(["commit", "-m", squashMsg], { cwd: targetWorktree, timeoutMs: 120_000 })
          if (squashCommit.exitCode !== 0) {
            return `Squash commit failed.\n${squashCommit.stderr || squashCommit.stdout}`
          }
        }

        const mergedSha = runGitOrThrow(["rev-parse", "HEAD"], { cwd: targetWorktree, timeoutMs: 10_000 }).trim()

        if (cleanup) {
          removeAgentWorktree({ repoRoot, path: agentWorktree, branch: agentBranch })
          deleteWorktreeRun(repoRoot, run.id)
        }

        return [
          "# Worktree Merge",
          `- task_id: ${run.id}`,
          `- merged_sha: ${mergedSha}`,
          `- target_branch: ${targetBranch}`,
          `- target_worktree: ${targetWorktree}`,
          `- agent_branch: ${agentBranch}`,
          `- cleanup: ${cleanup}`,
        ].join("\n")
      } finally {
        if (createdTargetWorktree && targetWorktree) {
          const res = runGit(["worktree", "remove", "--force", targetWorktree], {
            cwd: repoRoot,
            timeoutMs: 60_000,
          })
          if (res.exitCode !== 0) {
            log("[worktree_merge] failed to remove temporary target worktree", {
              taskId: run.id,
              targetWorktree,
              stderr: res.stderr,
            })
          }
        }
      }
    },
  })

  return {
    worktree_diff,
    worktree_merge,
  }
}
