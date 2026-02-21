import { z } from "zod"

export const WorktreeRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "error",
  "cancelled",
  "interrupt",
])

export type WorktreeRunStatus = z.infer<typeof WorktreeRunStatusSchema>

export const WorktreeInfoSchema = z
  .object({
    repoRoot: z.string(),
    path: z.string(),
    branch: z.string(),
    baseRef: z.string(),
  })
  .strict()

export type WorktreeInfo = z.infer<typeof WorktreeInfoSchema>

export const WorktreeRunSchema = z
  .object({
    id: z.string(),
    agent: z.string(),
    description: z.string(),
    status: WorktreeRunStatusSchema,
    sessionID: z.string().optional(),
    parentSessionID: z.string().optional(),
    worktree: WorktreeInfoSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().optional(),
  })
  .strict()

export type WorktreeRun = z.infer<typeof WorktreeRunSchema>
