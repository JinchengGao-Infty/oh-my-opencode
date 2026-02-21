import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { HydraTask, HydraTaskManager } from "../../features/hydra-task"
import { resolveRepoRoot } from "../../shared"

function resolveProjectRoot(directory: string): string {
  try {
    return resolveRepoRoot(directory)
  } catch {
    return directory
  }
}

export function createHydraTaskTools(ctx: PluginInput): Record<string, ToolDefinition> {
  const hydra_task_new: ToolDefinition = tool({
    description: "Create a Hydra markdown task file under .sisyphus/hydra/tasks/.",
    args: {
      title: tool.schema.string().describe("Task title"),
      description: tool.schema.string().describe("Task description (markdown)") ,
      allow: tool.schema.array(tool.schema.string()).optional().describe("Allowed file globs (comma-separated in markdown meta)") ,
      depends: tool.schema.array(tool.schema.string()).optional().describe("Dependency task IDs") ,
      agentClass: tool.schema.string().optional().describe("Agent class (optional)") ,
      model: tool.schema.string().optional().describe("Model string (optional)") ,
      thinking: tool.schema.enum(["low", "medium", "high", "xhigh"]).optional().describe("Thinking effort hint") ,
      timeout: tool.schema.number().optional().describe("Timeout seconds (optional)") ,
    },
    execute: async (args) => {
      const root = resolveProjectRoot(ctx.directory)
      const task = HydraTaskManager.create(root, {
        title: args.title,
        description: args.description,
        allow: args.allow,
        depends: args.depends,
        agentClass: args.agentClass,
        model: args.model,
        thinking: args.thinking as HydraTask.Thinking | undefined,
        timeout: args.timeout,
      })
      return `Hydra task created: ${task.meta.id}`
    },
  })

  const hydra_task_get: ToolDefinition = tool({
    description: "Get a Hydra task by ID.",
    args: {
      task_id: tool.schema.string().describe("Hydra task ID") ,
    },
    execute: async (args) => {
      const root = resolveProjectRoot(ctx.directory)
      const task = HydraTaskManager.get(root, args.task_id)
      if (!task) return `Hydra task not found: ${args.task_id}`
      return JSON.stringify(task, null, 2)
    },
  })

  const hydra_task_list: ToolDefinition = tool({
    description: "List Hydra tasks.",
    args: {
      status: tool.schema.array(tool.schema.enum(["pending", "running", "done", "failed", "cancelled"]))
        .optional()
        .describe("Optional status filter") ,
    },
    execute: async (args) => {
      const root = resolveProjectRoot(ctx.directory)
      const tasks = HydraTaskManager.list(root, {
        status: args.status as HydraTask.Status[] | undefined,
      })
      if (tasks.length === 0) return "No Hydra tasks."
      return tasks
        .map((t) => `- ${t.meta.id} [${t.meta.status}] ${t.title}${t.meta.depends.length ? ` (depends: ${t.meta.depends.join(",")})` : ""}`)
        .join("\n")
    },
  })

  const hydra_task_update_status: ToolDefinition = tool({
    description: "Update Hydra task status.",
    args: {
      task_id: tool.schema.string().describe("Hydra task ID") ,
      status: tool.schema.enum(["pending", "running", "done", "failed", "cancelled"]).describe("New status") ,
      reason: tool.schema.string().optional().describe("Optional reason for failed/cancelled status") ,
    },
    execute: async (args) => {
      const root = resolveProjectRoot(ctx.directory)
      const task = HydraTaskManager.updateStatus(
        root,
        args.task_id,
        args.status as HydraTask.Status,
        args.reason,
      )
      return `Hydra task updated: ${task.meta.id} -> ${task.meta.status}`
    },
  })

  const hydra_task_ready: ToolDefinition = tool({
    description: "List Hydra tasks that are pending and have all dependencies satisfied.",
    args: {},
    execute: async () => {
      const root = resolveProjectRoot(ctx.directory)
      const tasks = HydraTaskManager.list(root, { status: ["pending"] })
      const ready: HydraTask.Info[] = []
      const blocked: Array<{ task: HydraTask.Info; blockedBy: string[] }> = []
      const errors: Array<{ task: HydraTask.Info; reason: string }> = []

      for (const t of tasks) {
        const result = HydraTaskManager.checkReadiness(root, t.meta.id)
        if (result.kind === "ready") {
          ready.push(t)
          continue
        }
        if (result.kind === "blocked") {
          blocked.push({ task: t, blockedBy: result.blockedBy })
          continue
        }
        errors.push({ task: t, reason: result.reason })
      }

      if (ready.length === 0 && blocked.length === 0 && errors.length === 0) {
        return "No Hydra tasks."
      }

      const lines: string[] = []
      if (ready.length > 0) {
        lines.push("Ready:")
        for (const t of ready) {
          lines.push(`- ${t.meta.id} ${t.title}`)
        }
        lines.push("")
      }

      if (blocked.length > 0) {
        lines.push("Blocked:")
        for (const b of blocked) {
          lines.push(`- ${b.task.meta.id} ${b.task.title} (blocked by: ${b.blockedBy.join(", ")})`)
        }
        lines.push("")
      }

      if (errors.length > 0) {
        lines.push("Errors:")
        for (const e of errors) {
          lines.push(`- ${e.task.meta.id} ${e.task.title} (error: ${e.reason})`)
        }
      }

      return lines.join("\n").trimEnd()
    },
  })

  return {
    hydra_task_new,
    hydra_task_get,
    hydra_task_list,
    hydra_task_update_status,
    hydra_task_ready,
  }
}
