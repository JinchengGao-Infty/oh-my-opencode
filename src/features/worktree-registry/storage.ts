import { basename, dirname, isAbsolute, join } from "node:path"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import type { z } from "zod"
import { WorktreeRunSchema, type WorktreeRun } from "./types"

export function getWorktreeRunsDir(repoRoot: string): string {
  const root = repoRoot?.trim() || process.cwd()
  const base = isAbsolute(root) ? root : join(process.cwd(), root)
  return join(base, ".sisyphus", "worktrees", "runs")
}

export function getWorktreeRunPath(repoRoot: string, id: string): string {
  return join(getWorktreeRunsDir(repoRoot), `${id}.json`)
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

function readJsonSafe<T>(filePath: string, schema: z.ZodType<T>): T | null {
  try {
    if (!existsSync(filePath)) return null
    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)
    const result = schema.safeParse(parsed)
    if (!result.success) return null
    return result.data
  } catch {
    return null
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  ensureDir(dir)

  const tempPath = `${filePath}.tmp.${Date.now()}`
  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8")
    renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath)
    } catch {
      // ignore cleanup errors
    }
    throw error
  }
}

export function readWorktreeRun(repoRoot: string, id: string): WorktreeRun | null {
  return readJsonSafe(getWorktreeRunPath(repoRoot, id), WorktreeRunSchema)
}

export function upsertWorktreeRun(repoRoot: string, run: WorktreeRun): void {
  writeJsonAtomic(getWorktreeRunPath(repoRoot, run.id), run)
}

export function listWorktreeRunIds(repoRoot: string): string[] {
  const dir = getWorktreeRunsDir(repoRoot)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => basename(f, ".json"))
}

export function deleteWorktreeRun(repoRoot: string, id: string): boolean {
  const path = getWorktreeRunPath(repoRoot, id)
  try {
    if (!existsSync(path)) return false
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}
