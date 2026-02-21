/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  deleteWorktreeRun,
  getWorktreeRunPath,
  listWorktreeRunIds,
  readWorktreeRun,
  upsertWorktreeRun,
} from "./storage"

const TEST_ROOT = join(process.cwd(), ".test-worktree-registry")

describe("worktree-registry storage", () => {
  beforeEach(() => {
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true, force: true })
    }
    mkdirSync(TEST_ROOT, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true, force: true })
    }
  })

  test("#given run record #when upserting and reading #then returns same data", () => {
    // given
    const now = new Date().toISOString()
    const run = {
      id: "bg_test",
      agent: "atlas",
      description: "test",
      status: "running" as const,
      sessionID: "ses_123",
      parentSessionID: "ses_parent",
      worktree: {
        repoRoot: TEST_ROOT,
        path: join(TEST_ROOT, ".sisyphus", "worktrees", "atlas", "bg_test"),
        branch: "agent/atlas/bg_test",
        baseRef: "main",
      },
      createdAt: now,
      updatedAt: now,
    }

    // when
    upsertWorktreeRun(TEST_ROOT, run)
    const read = readWorktreeRun(TEST_ROOT, run.id)

    // then
    expect(read).toEqual(run)
    expect(listWorktreeRunIds(TEST_ROOT)).toContain(run.id)
  })

  test("#given existing run #when deleting #then returns true and removes file", () => {
    // given
    const now = new Date().toISOString()
    upsertWorktreeRun(TEST_ROOT, {
      id: "bg_delete",
      agent: "atlas",
      description: "x",
      status: "completed" as const,
      worktree: {
        repoRoot: TEST_ROOT,
        path: join(TEST_ROOT, "wt"),
        branch: "agent/atlas/bg_delete",
        baseRef: "main",
      },
      createdAt: now,
      updatedAt: now,
    })

    // when
    const deleted = deleteWorktreeRun(TEST_ROOT, "bg_delete")

    // then
    expect(deleted).toBe(true)
    expect(readWorktreeRun(TEST_ROOT, "bg_delete")).toBe(null)
  })

  test("#given multiple runs #when listing #then returns all ids", () => {
    // given
    const now = new Date().toISOString()
    upsertWorktreeRun(TEST_ROOT, {
      id: "bg_a",
      agent: "atlas",
      description: "a",
      status: "running" as const,
      worktree: { repoRoot: TEST_ROOT, path: join(TEST_ROOT, "a"), branch: "a", baseRef: "main" },
      createdAt: now,
      updatedAt: now,
    })
    upsertWorktreeRun(TEST_ROOT, {
      id: "bg_b",
      agent: "atlas",
      description: "b",
      status: "completed" as const,
      worktree: { repoRoot: TEST_ROOT, path: join(TEST_ROOT, "b"), branch: "b", baseRef: "main" },
      createdAt: now,
      updatedAt: now,
    })

    // when
    const ids = listWorktreeRunIds(TEST_ROOT)

    // then
    expect(ids).toContain("bg_a")
    expect(ids).toContain("bg_b")
  })

  test("#given missing id #when reading #then returns null", () => {
    // when
    const result = readWorktreeRun(TEST_ROOT, "does-not-exist")

    // then
    expect(result).toBe(null)
  })

  test("#given corrupted json #when reading #then returns null", () => {
    // given
    const path = getWorktreeRunPath(TEST_ROOT, "bg_corrupt")
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, "{not-json}", "utf-8")

    // when
    const result = readWorktreeRun(TEST_ROOT, "bg_corrupt")

    // then
    expect(result).toBe(null)
  })

  test("#given schema-invalid json #when reading #then returns null", () => {
    // given
    const path = getWorktreeRunPath(TEST_ROOT, "bg_schema_invalid")
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ id: "bg_schema_invalid", status: "wat" }, null, 2), "utf-8")

    // when
    const result = readWorktreeRun(TEST_ROOT, "bg_schema_invalid")

    // then
    expect(result).toBe(null)
  })
})
