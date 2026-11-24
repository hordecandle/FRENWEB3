// EQVPS white-label reseller API (https://eqvps.com/en/docs/reseller).
// Fren buys the server from its own wholesale balance, so the buyer never gets
// an EQVPS account, invoice or email. Response shapes beyond the documented
// routes are read defensively.

export function resellerClient({ token, base = "https://b2b.eqvps.com/api/reseller", fetchFn = fetch }) {
  async function call(method, path, body) {
    const res = await fetchFn(base + path, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": "fren-site/1.0",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { message: text.slice(0, 200) };
    }
    if (!res.ok) {
      // EQVPS doesn't document its error shape: keep whatever reason it gave.
      const why = json.message ?? json.error ?? json.errors ?? json.detail ?? (text ? text.slice(0, 300) : null);
      const reason = why == null ? "no message" : typeof why === "string" ? why : JSON.stringify(why).slice(0, 300);
      const err = new Error(`EQVPS reseller ${method} ${path} failed (${res.status}): ${reason}`);
      err.status = res.status;
      throw err;
    }
    return json && typeof json === "object" && "data" in json ? json.data : json;
  }

  const idOf = (j, ...keys) => {
    for (const k of keys) {
      const v = k.split(".").reduce((o, p) => o?.[p], j);
      if (v != null) return v;
    }
    return null;
  };

  return {
    async balanceUsd() {
      const j = await call("GET", "/balance");
      const n = Number(j.balance ?? j.amount ?? j.usd ?? j);
      return Number.isFinite(n) ? n : null;
    },

    /** os_id for an OS name, or null to let EQVPS use the location's default. */
    async osId(name) {
      const list = await call("GET", "/os");
      const os = (Array.isArray(list) ? list : (list.os ?? [])).find((o) => o.name === name);
      return os?.os_id ?? os?.id ?? null;
    },

    /** client_id for this email: reuses an existing client rather than making a second one. */
    async client(email, name) {
      const list = await call("GET", "/clients");
      const found = (Array.isArray(list) ? list : (list.clients ?? [])).find((c) => String(c.email).toLowerCase() === email);
      if (found) return found.id ?? found.client_id;
      const j = await call("POST", "/clients", { email, ...(name ? { name } : {}) });
      const id = idOf(j, "client_id", "id", "client.id");
      if (id == null) throw new Error("EQVPS didn't return a client id.");
      return id;
    },

    /** The service with this hostname, if one exists (makes ordering safe to retry). */
    async findByHostname(hostname) {
      const list = await call("GET", "/services");
      const s = (Array.isArray(list) ? list : (list.services ?? [])).find((v) => v.hostname === hostname || v.name === hostname);
      return s ? (s.id ?? s.service_id) : null;
    },

    /** service_id of the new server. */
    /** location: EQVPS's code ("fi", "de"); the plan must include it. */
    async order({ clientId, planId, osId, hostname, location }) {
      const j = await call("POST", "/orders", { client_id: clientId, plan_id: planId, hostname, ...(location ? { location } : {}), ...(osId ? { os_id: osId } : {}) });
      const id = idOf(j, "service_id", "service.id", "id", "services.0.id", "service_ids.0");
      if (id == null) throw new Error("EQVPS didn't return a server id.");
      return id;
    },

    /** { status, host, port, password } */
    async service(id) {
      const s = await call("GET", `/services/${id}`);
      const access = s.access ?? {};
      return {
        status: String(s.status ?? s.state ?? "").toLowerCase(),
        host: access.host ?? s.ip ?? s.ipv4 ?? s.main_ip ?? null,
        port: Number(access.port ?? s.ssh_port ?? 22),
        password: access.password ?? s.password ?? s.root_password ?? null,
      };
    },

    /** A fresh root password, for when the first one was already revealed. */
    async resetPassword(id) {
      const j = await call("POST", `/services/${id}/password`);
      return j.password ?? j.root_password ?? j.new_password ?? j.access?.password ?? null;
    },

    /** Wipes the server and installs this OS. { password } when EQVPS returns the new one. */
    async reinstall(id, osId) {
      const j = await call("POST", `/services/${id}/reinstall`, { os_id: osId });
      return { password: j?.password ?? j?.root_password ?? null };
    },

    async setAutorenew(id, enabled) {
      await call("POST", `/services/${id}/autorenew`, { enabled });
    },
  };
}
