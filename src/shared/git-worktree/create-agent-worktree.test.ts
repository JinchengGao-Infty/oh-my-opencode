/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"
import * as fs from "node:fs"

describe("createAgentWorktree", () => {
  let spawnSyncSpy: ReturnType<typeof spyOn>
  let existsSyncSpy: ReturnType<typeof spyOn>
  let mkdirSyncSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    existsSyncSpy = spyOn(fs, "existsSync").mockImplementation(() => false)
    mkdirSyncSpy = spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string)

    spawnSyncSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      ((file: string, args: string[], opts?: { cwd?: string }) => {
        if (file !== "git") throw new Error(`unexpected file: ${file}`)

        const cwd = opts?.cwd

        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
          return { status: 0, stdout: "/repo\n", stderr: "" } as unknown as childProcess.SpawnSyncReturns<string>
        }

        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") {
          expect(cwd).toBe("/project")
          return { status: 0, stdout: "feature\n", stderr: "" } as unknown as childProcess.SpawnSyncReturns<string>
        }

        if (args[0] === "show-ref" && args[1] === "--verify" && args[2] === "--quiet") {
          expect(cwd).toBe("/repo")
          // Branch does not exist
          return { status: 1, stdout: "", stderr: "" } as unknown as childProcess.SpawnSyncReturns<string>
        }

        if (args[0] === "worktree" && args[1] === "add") {
          expect(cwd).toBe("/repo")
          return { status: 0, stdout: "", stderr: "" } as unknown as childProcess.SpawnSyncReturns<string>
        }

        throw new Error(`unexpected args: ${args.join(" ")}`)
      }) as typeof childProcess.spawnSync,
    )
  })

  afterEach(() => {
    spawnSyncSpy.mockRestore()
    existsSyncSpy.mockRestore()
    mkdirSyncSpy.mockRestore()
  })

  test("uses spawnSync with arg arrays (no shell injection)", async () => {
    // given
    const { createAgentWorktree } = await import("./create-agent-worktree")

    // when
    const result = createAgentWorktree({
      directory: "/project",
      agent: "Atlas",
      runId: "bg 123",
    })

    // then
    expect(result).toEqual({
      repoRoot: "/repo",
      path: "/repo/.sisyphus/worktrees/atlas/bg-123",
      branch: "agent/atlas/bg-123",
      baseRef: "feature",
    })

    expect(spawnSyncSpy).toHaveBeenCalled()
    // Ensure no argument contains the cwd (would suggest shell concatenation)
    for (const call of spawnSyncSpy.mock.calls) {
      const [_file, argv] = call as unknown as [string, string[]]
      expect(Array.isArray(argv)).toBe(true)
      expect(argv.join(" ")).not.toContain("/project")
    }

    expect(mkdirSyncSpy).toHaveBeenCalled()
  })

  test("deletes existing agent branch before creating worktree", async () => {
    // given
    spawnSyncSpy.mockRestore()
    spawnSyncSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      ((file: string, args: string[], opts?: { cwd?: string }) => {
        if (file !== "git") throw new Error(`unexpected file: ${file}`)
        const cwd = opts?.cwd

        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
          return { status: 0, stdout: "/repo\n", stderr: "" } as unknown as childProcess.SpawnSyncReturns<string>
        }

        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") {
          expect(cwd).toBe("/project")
          return { status: 0, stdout: "feature\n", stderr: "" } as unknown as childProcess.SpawnSyncReturns<string>
        }

        if (args[0] === "show-ref" && args[1] === "--verify" && args[2] === "--quiet") {
          expect(cwd).toBe("/repo")
          // Branch exists
          return { status: 0, stdout: "", stderr: "" } as unknown as childProcess.SpawnSyncReturns<string>
        }

        if (args[0] === "worktree" && args[1] === "list" && args[2] === "--porcelain") {
          expect(cwd).toBe("/repo")
          return {
            status: 0,
            stdout: [
              "worktree /repo",
              "HEAD 1111111111111111111111111111111111111111",
              "branch refs/heads/feature",
              "",
              "worktree /repo/.sisyphus/worktrees/atlas/bg-123",
              "HEAD 2222222222222222222222222222222222222222",
              "branch refs/heads/agent/atlas/bg-123",
              "",
            ].join("\n"),
            stderr: "",
          } as unknown as childProcess.SpawnSyncReturns<string>
        }

        if (args[0] === "worktree" && args[1] === "remove" && args[2] === "--force") {
          expect(cwd).toBe("/repo")
          expect(args[3]).toBe("/repo/.sisyphus/worktrees/atlas/bg-123")
          return { status: 0, stdout: "", stderr: "" } as unknown as childProcess.SpawnSyncReturns<string>
        }

        if (args[0] === "branch" && args[1] === "-D") {
          expect(cwd).toBe("/repo")
          expect(args[2]).toBe("agent/atlas/bg-123")
          return { status: 0, stdout: "", stderr: "" } as unknown as childProcess.SpawnSyncReturns<string>
        }

        if (args[0] === "worktree" && args[1] === "add") {
          expect(cwd).toBe("/repo")
          return { status: 0, stdout: "", stderr: "" } as unknown as childProcess.SpawnSyncReturns<string>
        }

        throw new Error(`unexpected args: ${args.join(" ")}`)
      }) as typeof childProcess.spawnSync,
    )

    const { createAgentWorktree } = await import("./create-agent-worktree")

    // when
    const result = createAgentWorktree({
      directory: "/project",
      agent: "Atlas",
      runId: "bg 123",
    })

    // then
    expect(result.branch).toBe("agent/atlas/bg-123")
  })
})
