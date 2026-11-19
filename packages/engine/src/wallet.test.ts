import { describe, expect, it } from "vitest";
import { createSigner, generateKeys } from "@fren/signer";
import { buildTestFren } from "./testing.js";

describe("wallet reply", () => {
  it("shows ETH that was sent, not just USDC", async () => {
    const { fren } = buildTestFren({ signer: createSigner(generateKeys()), evmBalances: { "arbitrum:native": 5n * 10n ** 15n } });
    const { text } = await fren.wallet();
    expect(text).toContain("ETH: 0.005 ETH on Arbitrum.");
    expect(text).not.toMatch(/ETH on Base/); // nothing there, so not listed
  });
});
