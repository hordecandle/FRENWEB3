import { describe, expect, it } from "vitest";
import { registerStateContext } from "./index.js";

/** 22.11: the model said a Kamino withdrawal "still waits for /ok" after the dashboard's Approve ran it. Before every answer it now hears the engine's live state. */
function hook(call: (m: string, p: string) => Promise<unknown>, waitMs?: number) {
  let fn: (() => Promise<unknown>) | undefined;
  const api = { on: (name: string, f: () => Promise<unknown>) => void (name === "before_prompt_build" && (fn = f)) };
  registerStateContext(api as never, { call } as never, waitMs);
  return () => fn!();
}

describe("live state before every answer", () => {
  it("puts the engine's text in front of the turn", async () => {
    const run = hook(async (m, p) => (m === "GET" && p === "/agent/context" ? { text: "Nothing is waiting for the owner's /ok." } : null));
    expect(await run()).toEqual({ prependContext: "Nothing is waiting for the owner's /ok." });
  });

  it("an engine that fails or is slow leaves the turn as it was", async () => {
    expect(await hook(async () => { throw new Error("down"); })()).toBeUndefined();
    expect(await hook(() => new Promise((r) => setTimeout(() => r({ text: "late" }), 200)), 20)()).toBeUndefined();
  });
});
