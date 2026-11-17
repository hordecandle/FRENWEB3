import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeys } from "./keystore.js";
import { createSigner, hlDepositRpcUrl } from "./signer.js";

/** A JSON-RPC endpoint that records every method it is asked for and refuses all of them. */
function recordingRpc(): Promise<{ server: Server; url: string; methods: string[] }> {
  const methods: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const calls = [JSON.parse(body)].flat() as { id: number; method: string }[];
      for (const c of calls) methods.push(c.method);
      const out = calls.map((c) => ({ jsonrpc: "2.0", id: c.id, error: { code: -32000, message: "test endpoint" } }));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(JSON.parse(body)) ? out : out[0]));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, methods }),
    ),
  );
}

describe("hyperliquid deposit RPC", () => {
  it("prefers arbitrumRpcUrl, then the Arbitrum entry of evmRpcUrls, then the public default", () => {
    expect(hlDepositRpcUrl({ arbitrumRpcUrl: "https://a", evmRpcUrls: { 42161: "https://b" } }, false)).toBe("https://a");
    expect(hlDepositRpcUrl({ evmRpcUrls: { 42161: "https://main", 421614: "https://sep" } }, false)).toBe("https://main");
    expect(hlDepositRpcUrl({ evmRpcUrls: { 42161: "https://main", 421614: "https://sep" } }, true)).toBe("https://sep");
    // Other chains' RPCs are never used for the bridge.
    expect(hlDepositRpcUrl({ evmRpcUrls: { 8453: "https://base" } }, false)).toBeUndefined();
    expect(hlDepositRpcUrl({}, true)).toBeUndefined();
  });

  let rpc: Awaited<ReturnType<typeof recordingRpc>>;
  beforeAll(async () => (rpc = await recordingRpc()));
  afterAll(() => rpc.server.close());

  it("sends the deposit through the configured evmRpcUrls.arbitrum, not the public endpoint", async () => {
    // Only the configured RPC is reachable here: if the signer fell back to the
    // public endpoint, nothing would reach the recorder.
    const signer = createSigner(generateKeys(), { evmRpcUrls: { 421614: rpc.url } });
    await expect(signer.hlDepositFromArbitrum({ amountUsd: 10, isTestnet: true })).rejects.toThrow();
    expect(rpc.methods.length).toBeGreaterThan(0);
  });
});
