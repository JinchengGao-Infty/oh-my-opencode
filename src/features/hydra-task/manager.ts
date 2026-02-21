import { readdirSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { HydraTask } from "./task"
import { HydraTaskParser } from "./parser"
import {
  checkHydraTaskReadiness,
  type HydraTaskReadiness,
} from "./readiness-check"

export namespace HydraTaskManager {
  const TASKS_DIR = ".sisyphus/hydra/tasks"

  export function init(projectRoot: string): void {
    const dir = join(projectRoot, TASKS_DIR)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  export function getTaskPath(projectRoot: string, id: string): string {
    return join(projectRoot, TASKS_DIR, `${id}.md`)
  }

  export function create(
    projectRoot: string,
    input: {
      title: string
      description: string
      agentClass?: string
      model?: string
      thinking?: HydraTask.Thinking
      allow?: string[]
      timeout?: number
      depends?: string[]
    },
  ): HydraTask.Info {
    init(projectRoot)
    const task = HydraTask.create(input)
    HydraTaskParser.writeFile(getTaskPath(projectRoot, task.meta.id), task)
    return task
  }

  export function list(
    projectRoot: string,
    filter?: { status?: HydraTask.Status[] },
  ): HydraTask.Info[] {
    const files = listTaskFiles(projectRoot)
    const tasks = files.map((x) => HydraTaskParser.readFile(x))
    if (!filter?.status?.length) return tasks
    return tasks.filter((x) => filter.status?.includes(x.meta.status))
  }

  export function get(projectRoot: string, id: string): HydraTask.Info | undefined {
    init(projectRoot)
    const file = getTaskPath(projectRoot, id)
    if (!existsSync(file)) return
    return HydraTaskParser.readFile(file)
  }

  export function updateStatus(
    projectRoot: string,
    id: string,
    status: HydraTask.Status,
    reason?: string,
  ): HydraTask.Info {
    const task = get(projectRoot, id)
    if (!task) throw new Error(`HydraTaskManager.updateStatus: task not found: ${id}`)

    // No-op on identity transitions. Avoid rewriting files and triggering propagation.
    if (task.meta.status === status) {
      return task
    }

    assertValidStatusTransition(task.meta.status, status)

    const normalizedReason = typeof reason === "string" ? reason.trim() : undefined

    const now = new Date().toISOString()
    const started = status === "running" && !task.meta.started ? now : task.meta.started
    const finished = (status === "done" || status === "failed" || status === "cancelled") && !task.meta.finished
      ? now
      : task.meta.finished

    const next = HydraTask.Info.parse({
      ...task,
      meta: {
        ...task.meta,
        status,
        ...(normalizedReason ? { reason: normalizedReason } : {}),
        started,
        finished,
      },
    })

    HydraTaskParser.writeFile(getTaskPath(projectRoot, id), next)

    if (status === "failed" || status === "cancelled") {
      propagateDependencyFailure(projectRoot, next)
    }
    return next
  }

  export function updateOutput(
    projectRoot: string,
    id: string,
    output: string,
    filesChanged?: string[],
  ): HydraTask.Info {
    const task = get(projectRoot, id)
    if (!task) throw new Error(`HydraTaskManager.updateOutput: task not found: ${id}`)

    const next = HydraTask.Info.parse({
      ...task,
      output,
      filesChanged: filesChanged === undefined ? task.filesChanged : filesChanged,
    })

    HydraTaskParser.writeFile(getTaskPath(projectRoot, id), next)
    return next
  }

  export function cancel(projectRoot: string, id: string, reason?: string): HydraTask.Info {
    // Cancel is just a named wrapper for the status transition.
    return updateStatus(projectRoot, id, "cancelled", reason)
  }

  export function isReady(projectRoot: string, id: string): boolean {
    const readiness = checkReadiness(projectRoot, id)
    return readiness.kind === "ready"
  }

  export function checkReadiness(projectRoot: string, id: string): HydraTaskReadiness {
    const tasks = list(projectRoot)
    return checkHydraTaskReadiness({
      taskId: id,
      tasks,
    })
  }
}

function assertValidStatusTransition(from: HydraTask.Status, to: HydraTask.Status): void {
  if (from === to) return

  if (from === "pending") {
    if (to === "running" || to === "cancelled" || to === "failed") return
    throw new Error(`Invalid status transition: ${from} -> ${to}`)
  }

  if (from === "running") {
    if (to === "done" || to === "failed" || to === "cancelled") return
    throw new Error(`Invalid status transition: ${from} -> ${to}`)
  }

  // Terminal statuses are immutable.
  throw new Error(`Invalid status transition: ${from} -> ${to}`)
}

function propagateDependencyFailure(projectRoot: string, failed: HydraTask.Info): void {
  const tasks = HydraTaskManager.list(projectRoot)
  const taskMap = new Map<string, HydraTask.Info>()
  const dependents = new Map<string, Set<string>>()

  for (const t of tasks) {
    taskMap.set(t.meta.id, t)
    for (const dep of t.meta.depends) {
      const set = dependents.get(dep) ?? new Set<string>()
      set.add(t.meta.id)
      dependents.set(dep, set)
    }
  }

  taskMap.set(failed.meta.id, failed)

  const queue: string[] = [failed.meta.id]
  const visited = new Set<string>([failed.meta.id])

  while (queue.length > 0) {
    const currentId = queue.shift()!
    const current = taskMap.get(currentId)
    if (!current) continue

    const targets = dependents.get(currentId)
    if (!targets || targets.size === 0) continue

    for (const dependentId of targets) {
      if (visited.has(dependentId)) continue
      const dependent = taskMap.get(dependentId)
      if (!dependent) continue
      if (dependent.meta.status !== "pending") {
        visited.add(dependentId)
        continue
      }

      const now = new Date().toISOString()
      const upstreamReason = current.meta.reason ? `: ${current.meta.reason}` : ""
      const reason = `Dependency ${current.meta.id} is ${current.meta.status}${upstreamReason}`

      const next = HydraTask.Info.parse({
        ...dependent,
        meta: {
          ...dependent.meta,
          status: "failed",
          reason,
          finished: dependent.meta.finished ?? now,
        },
      })

      HydraTaskParser.writeFile(HydraTaskManager.getTaskPath(projectRoot, dependentId), next)
      taskMap.set(dependentId, next)
      visited.add(dependentId)
      queue.push(dependentId)
    }
  }
}

function listTaskFiles(projectRoot: string): string[] {
  HydraTaskManager.init(projectRoot)
  const dir = join(projectRoot, ".sisyphus/hydra/tasks")
  if (!existsSync(dir)) return []
  const list = readdirSync(dir, { withFileTypes: true })
  const files = list
    .filter((x) => x.isFile() && x.name.endsWith(".md"))
    .map((x) => join(dir, x.name))
  files.sort()
  return files
}
