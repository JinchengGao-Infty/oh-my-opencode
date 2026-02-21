/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { HydraTaskManager } from "./manager"
import { HydraTaskParser } from "./parser"

const TEST_ROOT = join(process.cwd(), ".test-hydra-task")

describe("HydraTaskManager", () => {
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

  test("#given dependent tasks #when dependencies satisfied #then isReady becomes true", () => {
    // given
    const t1 = HydraTaskManager.create(TEST_ROOT, {
      title: "t1",
      description: "first",
    })
    const t2 = HydraTaskManager.create(TEST_ROOT, {
      title: "t2",
      description: "second",
      depends: [t1.meta.id],
    })

    // when
    const readyBefore = HydraTaskManager.isReady(TEST_ROOT, t2.meta.id)
    HydraTaskManager.updateStatus(TEST_ROOT, t1.meta.id, "running")
    HydraTaskManager.updateStatus(TEST_ROOT, t1.meta.id, "done")
    const readyAfter = HydraTaskManager.isReady(TEST_ROOT, t2.meta.id)

    // then
    expect(readyBefore).toBe(false)
    expect(readyAfter).toBe(true)
  })

  test("#given non-pending task #when checking readiness #then returns false", () => {
    // given
    const task = HydraTaskManager.create(TEST_ROOT, {
      title: "already running",
      description: "x",
    })
    HydraTaskManager.updateStatus(TEST_ROOT, task.meta.id, "running")

    // when
    const ready = HydraTaskManager.isReady(TEST_ROOT, task.meta.id)

    // then
    expect(ready).toBe(false)
  })

  test("#given cycle dependency #when checking readiness #then returns error", () => {
    // given
    const a = HydraTaskManager.create(TEST_ROOT, {
      title: "A",
      description: "a",
    })
    const b = HydraTaskManager.create(TEST_ROOT, {
      title: "B",
      description: "b",
      depends: [a.meta.id],
    })

    // create a cycle: A depends on B
    const a2 = {
      ...a,
      meta: {
        ...a.meta,
        depends: [b.meta.id],
      },
    }
    HydraTaskParser.writeFile(HydraTaskManager.getTaskPath(TEST_ROOT, a.meta.id), a2)

    // when
    const readiness = HydraTaskManager.checkReadiness(TEST_ROOT, a.meta.id)

    // then
    expect(readiness.kind).toBe("error")
    if (readiness.kind === "error") {
      expect(readiness.reason).toContain("Dependency cycle detected")
    }
  })

  test("#given self-loop dependency #when checking readiness #then returns error", () => {
    // given
    const a = HydraTaskManager.create(TEST_ROOT, {
      title: "A",
      description: "a",
    })

    const a2 = {
      ...a,
      meta: {
        ...a.meta,
        depends: [a.meta.id],
      },
    }
    HydraTaskParser.writeFile(HydraTaskManager.getTaskPath(TEST_ROOT, a.meta.id), a2)

    // when
    const readiness = HydraTaskManager.checkReadiness(TEST_ROOT, a.meta.id)

    // then
    expect(readiness.kind).toBe("error")
    if (readiness.kind === "error") {
      expect(readiness.reason).toContain("Dependency cycle detected")
    }
  })

  test("#given multi-node cycle #when checking readiness #then returns error", () => {
    // given
    const a = HydraTaskManager.create(TEST_ROOT, {
      title: "A",
      description: "a",
    })
    const b = HydraTaskManager.create(TEST_ROOT, {
      title: "B",
      description: "b",
      depends: [a.meta.id],
    })
    const c = HydraTaskManager.create(TEST_ROOT, {
      title: "C",
      description: "c",
      depends: [b.meta.id],
    })

    // create a cycle: A depends on C
    const a2 = {
      ...a,
      meta: {
        ...a.meta,
        depends: [c.meta.id],
      },
    }
    HydraTaskParser.writeFile(HydraTaskManager.getTaskPath(TEST_ROOT, a.meta.id), a2)

    // when
    const readiness = HydraTaskManager.checkReadiness(TEST_ROOT, a.meta.id)

    // then
    expect(readiness.kind).toBe("error")
    if (readiness.kind === "error") {
      expect(readiness.reason).toContain("Dependency cycle detected")
    }
  })

  test("#given missing dependency id #when checking readiness #then returns error", () => {
    // given
    const task = HydraTaskManager.create(TEST_ROOT, {
      title: "Missing",
      description: "x",
      depends: ["t-does-not-exist"],
    })

    // when
    const readiness = HydraTaskManager.checkReadiness(TEST_ROOT, task.meta.id)

    // then
    expect(readiness.kind).toBe("error")
    if (readiness.kind === "error") {
      expect(readiness.reason).toContain("Missing dependency task")
    }
  })

  test("#given failed dependency #when updating status #then propagates failure to downstream pending tasks", () => {
    // given
    const a = HydraTaskManager.create(TEST_ROOT, {
      title: "A",
      description: "a",
    })
    const b = HydraTaskManager.create(TEST_ROOT, {
      title: "B",
      description: "b",
      depends: [a.meta.id],
    })
    const c = HydraTaskManager.create(TEST_ROOT, {
      title: "C",
      description: "c",
      depends: [b.meta.id],
    })

    // when
    HydraTaskManager.updateStatus(TEST_ROOT, a.meta.id, "failed", "boom")

    // then
    const b2 = HydraTaskManager.get(TEST_ROOT, b.meta.id)
    const c2 = HydraTaskManager.get(TEST_ROOT, c.meta.id)
    expect(b2?.meta.status).toBe("failed")
    expect(c2?.meta.status).toBe("failed")
    expect(b2?.meta.reason).toContain(a.meta.id)
    expect(b2?.meta.reason).toContain("boom")
  })

  test("#given cancelled dependency with reason #when cancelling #then downstream pending tasks fail with propagated reason", () => {
    // given
    const a = HydraTaskManager.create(TEST_ROOT, {
      title: "A",
      description: "a",
    })
    const b = HydraTaskManager.create(TEST_ROOT, {
      title: "B",
      description: "b",
      depends: [a.meta.id],
    })

    // when
    HydraTaskManager.cancel(TEST_ROOT, a.meta.id, "user aborted")

    // then
    const a2 = HydraTaskManager.get(TEST_ROOT, a.meta.id)
    const b2 = HydraTaskManager.get(TEST_ROOT, b.meta.id)
    expect(a2?.meta.status).toBe("cancelled")
    expect(a2?.meta.reason).toBe("user aborted")
    expect(b2?.meta.status).toBe("failed")
    expect(b2?.meta.reason).toContain("cancelled")
    expect(b2?.meta.reason).toContain("user aborted")
  })

  test("#given cancelled dependency without reason #when cancelling #then downstream reason does not include undefined", () => {
    // given
    const a = HydraTaskManager.create(TEST_ROOT, {
      title: "A",
      description: "a",
    })
    const b = HydraTaskManager.create(TEST_ROOT, {
      title: "B",
      description: "b",
      depends: [a.meta.id],
    })

    // when
    HydraTaskManager.cancel(TEST_ROOT, a.meta.id)

    // then
    const b2 = HydraTaskManager.get(TEST_ROOT, b.meta.id)
    expect(b2?.meta.status).toBe("failed")
    expect(b2?.meta.reason).toContain(a.meta.id)
    expect(b2?.meta.reason).toContain("cancelled")
    expect(b2?.meta.reason).not.toContain("undefined")
  })

  test("#given multi-layer dependency #when cancelling root #then cancellation propagates as failure through all pending dependents", () => {
    // given
    const a = HydraTaskManager.create(TEST_ROOT, { title: "A", description: "a" })
    const b = HydraTaskManager.create(TEST_ROOT, { title: "B", description: "b", depends: [a.meta.id] })
    const c = HydraTaskManager.create(TEST_ROOT, { title: "C", description: "c", depends: [b.meta.id] })
    const d = HydraTaskManager.create(TEST_ROOT, { title: "D", description: "d", depends: [c.meta.id] })

    // when
    HydraTaskManager.cancel(TEST_ROOT, a.meta.id)

    // then
    const b2 = HydraTaskManager.get(TEST_ROOT, b.meta.id)
    const c2 = HydraTaskManager.get(TEST_ROOT, c.meta.id)
    const d2 = HydraTaskManager.get(TEST_ROOT, d.meta.id)
    expect(b2?.meta.status).toBe("failed")
    expect(c2?.meta.status).toBe("failed")
    expect(d2?.meta.status).toBe("failed")
    expect(b2?.meta.reason).not.toContain("undefined")
    expect(c2?.meta.reason).not.toContain("undefined")
    expect(d2?.meta.reason).not.toContain("undefined")
  })

  test("#given diamond dependency #when completing parents #then downstream becomes ready", () => {
    // given
    const a = HydraTaskManager.create(TEST_ROOT, {
      title: "A",
      description: "a",
    })
    const b = HydraTaskManager.create(TEST_ROOT, {
      title: "B",
      description: "b",
      depends: [a.meta.id],
    })
    const c = HydraTaskManager.create(TEST_ROOT, {
      title: "C",
      description: "c",
      depends: [a.meta.id],
    })
    const d = HydraTaskManager.create(TEST_ROOT, {
      title: "D",
      description: "d",
      depends: [b.meta.id, c.meta.id],
    })

    // when/then
    expect(HydraTaskManager.isReady(TEST_ROOT, d.meta.id)).toBe(false)

    HydraTaskManager.updateStatus(TEST_ROOT, a.meta.id, "running")
    HydraTaskManager.updateStatus(TEST_ROOT, a.meta.id, "done")
    expect(HydraTaskManager.isReady(TEST_ROOT, d.meta.id)).toBe(false)

    HydraTaskManager.updateStatus(TEST_ROOT, b.meta.id, "running")
    HydraTaskManager.updateStatus(TEST_ROOT, b.meta.id, "done")
    expect(HydraTaskManager.isReady(TEST_ROOT, d.meta.id)).toBe(false)

    HydraTaskManager.updateStatus(TEST_ROOT, c.meta.id, "running")
    HydraTaskManager.updateStatus(TEST_ROOT, c.meta.id, "done")
    expect(HydraTaskManager.isReady(TEST_ROOT, d.meta.id)).toBe(true)
  })

  test("#given running dependent #when upstream fails #then propagation skips non-pending task", () => {
    // given
    const a = HydraTaskManager.create(TEST_ROOT, {
      title: "A",
      description: "a",
    })
    const b = HydraTaskManager.create(TEST_ROOT, {
      title: "B",
      description: "b",
      depends: [a.meta.id],
    })

    HydraTaskManager.updateStatus(TEST_ROOT, b.meta.id, "running")

    // when
    HydraTaskManager.updateStatus(TEST_ROOT, a.meta.id, "failed", "boom")

    // then
    const b2 = HydraTaskManager.get(TEST_ROOT, b.meta.id)
    expect(b2?.meta.status).toBe("running")
  })

  test("#given reason with newline #when serializing and parsing #then preserves newline via \\n escape", () => {
    // given
    const original = HydraTaskManager.create(TEST_ROOT, {
      title: "Reason",
      description: "x",
    })
    HydraTaskManager.updateStatus(TEST_ROOT, original.meta.id, "running")
    HydraTaskManager.updateStatus(TEST_ROOT, original.meta.id, "failed", "line1\nline2:with:colons")

    // when
    const parsed = HydraTaskManager.get(TEST_ROOT, original.meta.id)

    // then
    expect(parsed?.meta.status).toBe("failed")
    expect(parsed?.meta.reason).toBe("line1\nline2:with:colons")
  })

  test("#given pending task #when attempting pending->done #then throws", () => {
    // given
    const task = HydraTaskManager.create(TEST_ROOT, {
      title: "Invalid",
      description: "x",
    })

    // when/then
    expect(() => HydraTaskManager.updateStatus(TEST_ROOT, task.meta.id, "done")).toThrow(
      "Invalid status transition",
    )
  })

  test("#given done task #when attempting done->pending #then throws", () => {
    // given
    const task = HydraTaskManager.create(TEST_ROOT, {
      title: "Terminal",
      description: "x",
    })
    HydraTaskManager.updateStatus(TEST_ROOT, task.meta.id, "running")
    HydraTaskManager.updateStatus(TEST_ROOT, task.meta.id, "done")

    // when/then
    expect(() => HydraTaskManager.updateStatus(TEST_ROOT, task.meta.id, "pending")).toThrow(
      "Invalid status transition",
    )
  })

  test("#given identity transition #when updating same status again #then does not rewrite reason", () => {
    // given
    const task = HydraTaskManager.create(TEST_ROOT, {
      title: "Identity",
      description: "x",
    })
    HydraTaskManager.updateStatus(TEST_ROOT, task.meta.id, "running")
    HydraTaskManager.updateStatus(TEST_ROOT, task.meta.id, "failed", "first")
    const before = HydraTaskManager.get(TEST_ROOT, task.meta.id)

    // when
    HydraTaskManager.updateStatus(TEST_ROOT, task.meta.id, "failed", "second")
    const after = HydraTaskManager.get(TEST_ROOT, task.meta.id)

    // then
    expect(before?.meta.reason).toBe("first")
    expect(after?.meta.reason).toBe("first")
  })
})
