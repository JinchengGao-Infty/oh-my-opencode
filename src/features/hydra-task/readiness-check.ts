import { HydraTask } from "./task"

export type HydraTaskReadiness =
  | { kind: "ready" }
  | { kind: "blocked"; blockedBy: string[] }
  | { kind: "error"; reason: string }

function formatDependencyReason(dep: HydraTask.Info): string {
  const base = `Dependency ${dep.meta.id} is ${dep.meta.status}`
  const reason = dep.meta.reason ? `: ${dep.meta.reason}` : ""
  return base + reason
}

export function checkHydraTaskReadiness(args: {
  taskId: string
  tasks: HydraTask.Info[]
}): HydraTaskReadiness {
  const map = new Map<string, HydraTask.Info>()
  for (const t of args.tasks) {
    map.set(t.meta.id, t)
  }

  const root = map.get(args.taskId)
  if (!root) {
    return { kind: "error", reason: `Hydra task not found: ${args.taskId}` }
  }

  if (root.meta.status !== "pending") {
    return {
      kind: "error",
      reason: `Hydra task ${root.meta.id} is '${root.meta.status}', not runnable.`,
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const blocked = new Set<string>()

  const dfs = (id: string): HydraTaskReadiness => {
    if (visited.has(id)) return { kind: "ready" }

    if (visiting.has(id)) {
      const start = stack.indexOf(id)
      const cycle = start >= 0 ? stack.slice(start).concat(id) : [id]
      return {
        kind: "error",
        reason: `Dependency cycle detected: ${cycle.join(" -> ")}`,
      }
    }

    const task = map.get(id)
    if (!task) {
      return { kind: "error", reason: `Missing dependency task: ${id}` }
    }

    visiting.add(id)
    stack.push(id)

    for (const depId of task.meta.depends) {
      const dep = map.get(depId)
      if (!dep) {
        return { kind: "error", reason: `Missing dependency task: ${depId}` }
      }

      if (dep.meta.status === "failed" || dep.meta.status === "cancelled") {
        return { kind: "error", reason: formatDependencyReason(dep) }
      }

      if (dep.meta.status !== "done") {
        const result = dfs(depId)
        if (result.kind === "error") return result
        blocked.add(depId)
      }
    }

    stack.pop()
    visiting.delete(id)
    visited.add(id)
    return { kind: "ready" }
  }

  const result = dfs(args.taskId)
  if (result.kind === "error") return result
  if (blocked.size > 0) {
    return { kind: "blocked", blockedBy: Array.from(blocked).sort() }
  }
  return { kind: "ready" }
}
