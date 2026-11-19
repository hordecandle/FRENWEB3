import { describe, expect, it } from "vitest";
import { registerReadySignal } from "./index.js";

describe("ready signal", () => {
  it("tells the engine the gateway started, retrying while the engine comes up", async () => {
    let onStart: (() => Promise<void>) | undefined;
    const api = { on: (name: string, fn: () => Promise<void>) => void (name === "gateway_start" && (onStart = fn)) };
    const calls: string[] = [];
    let fails = 2;
    const client = {
      call: async (method: string, path: string) => {
        calls.push(`${method} ${path}`);
        if (fails-- > 0) throw new Error("engine not up");
        return {} as never;
      },
    };
    registerReadySignal(api as never, client as never, 1, 5);
    expect(onStart).toBeDefined();
    await onStart!();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual(["POST /gateway/up", "POST /gateway/up", "POST /gateway/up"]);
  });
});
