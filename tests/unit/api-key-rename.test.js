import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let PUT;
let createApiKey;
let getApiKeyById;

function put(id, body) {
  const request = new Request(`https://9router.local/api/keys/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PUT(request, { params: Promise.resolve({ id }) });
}

describe("PUT /api/keys/[id] rename", () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-rename-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    vi.doMock("next/server", () => ({
      NextResponse: {
        json(body, init = {}) {
          return new Response(JSON.stringify(body), {
            status: init.status || 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    }));
    ({ PUT } = await import("@/app/api/keys/[id]/route.js"));
    ({ createApiKey, getApiKeyById } = await import("@/lib/db/index.js"));
  });

  afterEach(() => {
    vi.doUnmock("next/server");
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("renames the key and trims the name", async () => {
    const key = await createApiKey("old name", "machine-test");
    const res = await put(key.id, { name: "  9router-lab  " });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key.name).toBe("9router-lab");
    const stored = await getApiKeyById(key.id);
    expect(stored.name).toBe("9router-lab");
    expect(stored.key).toBe(key.key);
    expect(stored.isActive).toBe(true);
  });

  it("rejects an empty name with 400 and keeps the old one", async () => {
    const key = await createApiKey("keep me", "machine-test");
    for (const name of ["", "   ", 42, null]) {
      const res = await put(key.id, { name });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/name/i);
    }
    expect((await getApiKeyById(key.id)).name).toBe("keep me");
  });

  it("rejects a name longer than 100 characters", async () => {
    const key = await createApiKey("keep me", "machine-test");
    const res = await put(key.id, { name: "x".repeat(101) });
    expect(res.status).toBe(400);
    expect((await getApiKeyById(key.id)).name).toBe("keep me");
  });

  it("allows a duplicate name, like creation does", async () => {
    await createApiKey("shared", "machine-test");
    const other = await createApiKey("other", "machine-test");
    const res = await put(other.id, { name: "shared" });
    expect(res.status).toBe(200);
    expect((await getApiKeyById(other.id)).name).toBe("shared");
  });

  it("still toggles isActive without touching the name", async () => {
    const key = await createApiKey("toggle", "machine-test");
    const res = await put(key.id, { isActive: false });
    expect(res.status).toBe(200);
    const stored = await getApiKeyById(key.id);
    expect(stored.isActive).toBe(false);
    expect(stored.name).toBe("toggle");
  });

  it("renames and updates access in the same request", async () => {
    const key = await createApiKey("both", "machine-test");
    const res = await put(key.id, { name: "renamed", access: { restricted: true, allow: ["gpt-x"] } });
    expect(res.status).toBe(200);
    const stored = await getApiKeyById(key.id);
    expect(stored.name).toBe("renamed");
    expect(stored.access).toEqual({ restricted: true, allow: ["gpt-x"] });
  });

  it("invalid access rejects the whole request, name included", async () => {
    const key = await createApiKey("keep me", "machine-test");
    const res = await put(key.id, { name: "renamed", access: { restricted: "yes" } });
    expect(res.status).toBe(400);
    expect((await getApiKeyById(key.id)).name).toBe("keep me");
  });

  it("returns 404 for an unknown key", async () => {
    const res = await put("missing", { name: "x" });
    expect(res.status).toBe(404);
  });
});
