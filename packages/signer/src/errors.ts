/** A request the signer refuses on its own rules (as opposed to a network or key error). */
export class SignerRuleError extends Error {
  override name = "SignerRuleError";
}
