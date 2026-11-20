import { describe, expect, it } from "vitest";
import { openClawConfigPath, telegramFromOpenClaw } from "./owner-telegram.js";

const TOKEN = "8123456789:AAEexampleexampleexample_123";

describe("telegramFromOpenClaw", () => {
  it("reads the bot token and the owner Fren setup wrote", () => {
    const cfg = JSON.stringify({
      channels: { telegram: { botToken: TOKEN, allowFrom: ["555000111"], dmPolicy: "allowlist" } },
      commands: { ownerAllowFrom: ["telegram:555000111"] },
    });
    expect(telegramFromOpenClaw(cfg)).toEqual({ botToken: TOKEN, ownerChatId: "555000111" });
  });

  it("takes JSON5 (comments, trailing commas) and a single named account", () => {
    const cfg = `{
      // written by hand
      channels: { "telegram": { "accounts": { "main": { "botToken": "${TOKEN}", }, }, "allowFrom": ["777000222"], }, },
    }`.replace(/channels:/, '"channels":');
    expect(telegramFromOpenClaw(cfg)).toEqual({ botToken: TOKEN, ownerChatId: "777000222" });
  });

  it("falls back to the gateway notify target for the owner", () => {
    const cfg = JSON.stringify({ channels: { telegram: { botToken: TOKEN } } });
    expect(telegramFromOpenClaw(cfg, [{ channel: "telegram", to: "999888777" }])).toEqual({ botToken: TOKEN, ownerChatId: "999888777" });
  });

  it("says nothing when it can't tell the token or the owner", () => {
    expect(telegramFromOpenClaw("not json")).toBeNull();
    expect(telegramFromOpenClaw(JSON.stringify({ channels: { whatsapp: {} } }))).toBeNull();
    expect(telegramFromOpenClaw(JSON.stringify({ channels: { telegram: { botToken: TOKEN, allowFrom: ["1111", "2222"] } } }))).toBeNull();
    expect(telegramFromOpenClaw(JSON.stringify({ channels: { telegram: { botToken: { source: "env", id: "TG" } } }, commands: { ownerAllowFrom: ["telegram:1234"] } }))).toBeNull();
    expect(telegramFromOpenClaw(JSON.stringify({ channels: { telegram: { enabled: false, botToken: TOKEN } }, commands: { ownerAllowFrom: ["telegram:1234"] } }))).toBeNull();
  });

  it("looks where OpenClaw keeps its config", () => {
    expect(openClawConfigPath({}, "/var/lib/fren-engine")).toBe("/var/lib/fren-engine/.openclaw/openclaw.json");
    expect(openClawConfigPath({ OPENCLAW_CONFIG_PATH: "/x/oc.json" }, "/h")).toBe("/x/oc.json");
  });
});
