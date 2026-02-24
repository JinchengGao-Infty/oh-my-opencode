import type { BackgroundTask } from "./types"
import type { ResultHandlerContext } from "./result-handler-context"
import { TASK_CLEANUP_DELAY_MS } from "./constants"
import { createInternalAgentTextPart, log } from "../../shared"
import { getTaskToastManager } from "../task-toast-manager"
import { formatDuration } from "./duration-formatter"
import { buildBackgroundTaskNotificationText } from "./background-task-notification-template"
import { resolveParentSessionAgentAndModel } from "./parent-session-context-resolver"

export async function notifyParentSession(
  task: BackgroundTask,
  ctx: ResultHandlerContext
): Promise<void> {
  const { client, state } = ctx

  const duration = formatDuration(task.startedAt ?? task.completedAt ?? new Date(), task.completedAt)
  log("[background-agent] notifyParentSession called for task:", task.id)

  const toastManager = getTaskToastManager()
  if (toastManager) {
    toastManager.showCompletionToast({
      id: task.id,
      description: task.description,
      duration,
    })
  }

  const pendingSet = state.pendingByParent.get(task.parentSessionID)
  if (pendingSet) {
    pendingSet.delete(task.id)
    if (pendingSet.size === 0) {
      state.pendingByParent.delete(task.parentSessionID)
    }
  }

  const allComplete = !pendingSet || pendingSet.size === 0
  const remainingCount = pendingSet?.size ?? 0

  const statusText = task.status === "completed" ? "COMPLETED" : task.status === "interrupt" ? "INTERRUPTED" : "CANCELLED"

  const completedTasks = allComplete
    ? Array.from(state.tasks.values()).filter(
        (t) =>
          t.parentSessionID === task.parentSessionID &&
          t.status !== "running" &&
          t.status !== "pending"
      )
    : []

  const notification = buildBackgroundTaskNotificationText({
    task,
    duration,
    statusText,
    allComplete,
    remainingCount,
    completedTasks,
  })

  const { agent, model, tools } = await resolveParentSessionAgentAndModel({ client, task })

  log("[background-agent] notifyParentSession context:", {
    taskId: task.id,
    resolvedAgent: agent,
    resolvedModel: model,
  })

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 2000
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await client.session.promptAsync({
        path: { id: task.parentSessionID },
        body: {
          noReply: !allComplete,
          ...(agent !== undefined ? { agent } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(tools ? { tools } : {}),
          parts: [createInternalAgentTextPart(notification)],
        },
      })
      log("[background-agent] Sent notification to parent session:", {
        taskId: task.id,
        allComplete,
        noReply: !allComplete,
        attempt,
      })
      lastError = undefined
      break
    } catch (error) {
      lastError = error
      log(`[background-agent] Failed to send notification (attempt ${attempt}/${MAX_RETRIES}):`, error)
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
      }
    }
  }
  if (lastError) {
    log("[background-agent] All notification retries exhausted for task:", task.id)
  }

  if (!allComplete) return

  for (const completedTask of completedTasks) {
    const taskId = completedTask.id
    state.clearCompletionTimer(taskId)
    const timer = setTimeout(() => {
      state.completionTimers.delete(taskId)
      if (state.tasks.has(taskId)) {
        state.clearNotificationsForTask(taskId)
        state.tasks.delete(taskId)
        log("[background-agent] Removed completed task from memory:", taskId)
      }
    }, TASK_CLEANUP_DELAY_MS)
    state.setCompletionTimer(taskId, timer)
  }
}
