import { expect, test } from "bun:test"
import { poddisruptionbudgetsConfig } from "../src/resources/config/kubernetes-core"

test("disruption budgets keep counts numeric and percentages as strings", () => {
  const build = poddisruptionbudgetsConfig.buildCreateResource!
  for (const [input, expected] of [["1", 1], ["0", 0], [" 2 ", 2], ["50%", "50%"], ["invalid", "invalid"]] as const) {
    const resource = build({ name: "budget", namespace: "test", minAvailable: input })
    expect((resource.spec as Record<string, unknown>).minAvailable).toBe(expected)
  }
})
