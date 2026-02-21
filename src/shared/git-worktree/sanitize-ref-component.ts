export function sanitizeRefComponent(input: string): string {
  const raw = (input ?? "").trim()
  if (!raw) return "agent"

  // Keep ref-safe characters only. Git has more rules, but this is conservative.
  const sanitized = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")

  return sanitized || "agent"
}
