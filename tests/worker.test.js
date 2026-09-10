import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.js";

const payload = '{"satellites":[]}';
const uploaded = new Date("2026-09-10T01:02:03.987Z");
const modified = "Thu, 10 Sep 2026 01:02:03 GMT";
const before = "Thu, 10 Sep 2026 01:02:02 GMT";
const after = "Thu, 10 Sep 2026 01:02:04 GMT";

function fixture({ cached = false, missing = false, etag = '"snapshot"' } = {}) {
  const cancel = vi.fn();
  const metadata = {
    httpEtag: etag,
    size: payload.length,
    uploaded,
    writeHttpMetadata(headers) {
      headers.set("Content-Type", "application/json");
    },
  };
  const get = vi.fn(async () => missing ? null : {
    ...metadata,
    body: new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(payload)); },
      pull(controller) { controller.close(); },
      cancel,
    }),
  });
  const head = vi.fn(async () => missing ? null : metadata);
  const entries = new Map();
  if (cached) entries.set("https://sky.example/satellites.json", {
    body: payload,
    headers: {
      ETag: etag,
      "Last-Modified": modified,
      "Content-Type": "application/json",
      "Content-Length": String(payload.length),
      "Cache-Control": "public, max-age=1800, must-revalidate",
    },
  });
  const cache = {
    match: vi.fn(async request => {
      const entry = entries.get(request.url);
      return entry ? new Response(entry.body, { headers: entry.headers }) : undefined;
    }),
    put: vi.fn(async (request, response) => {
      entries.set(request.url, {
        body: await response.text(),
        headers: Object.fromEntries(response.headers),
      });
    }),
  };
  vi.stubGlobal("caches", { default: cache });
  const pending = [];
  const fetch = (headers = {}, method = "GET", path = "/satellites.json") =>
    worker.fetch(new Request(`https://sky.example${path}`, { method, headers }),
      { BUCKET: { get, head } }, { waitUntil: promise => pending.push(promise) });
  return { fetch, get, head, cache, cancel, settle: () => Promise.all(pending) };
}

afterEach(() => vi.unstubAllGlobals());

const conditions = [
  ["no condition", {}, 200],
  ["matching ETag", { "If-None-Match": '"snapshot"' }, 304],
  ["nonmatching ETag", { "If-None-Match": '"other"' }, 200],
  ["weak cache validator", { "If-None-Match": 'W/"snapshot"' }, 304],
  ["validator list", { "If-None-Match": '"other", W/"snapshot"' }, 304],
  ["wildcard cache validator", { "If-None-Match": "*" }, 304],
  ["matching precondition", { "If-Match": '"snapshot"' }, 200],
  ["wildcard precondition", { "If-Match": "*" }, 200],
  ["failed precondition", { "If-Match": '"other"' }, 412],
  ["weak tags fail strong comparison", { "If-Match": 'W/"snapshot"' }, 412],
  ["If-Match precedes If-None-Match", { "If-Match": '"other"', "If-None-Match": '"snapshot"' }, 412],
  ["If-None-Match follows a successful If-Match", { "If-Match": '"snapshot"', "If-None-Match": '"snapshot"' }, 304],
  ["equal modification date ignores milliseconds", { "If-Modified-Since": modified }, 304],
  ["later modification date", { "If-Modified-Since": after }, 304],
  ["earlier modification date", { "If-Modified-Since": before }, 200],
  ["equal unmodified date ignores milliseconds", { "If-Unmodified-Since": modified }, 200],
  ["failed date precondition", { "If-Unmodified-Since": before }, 412],
  ["date precondition precedes cache validator", { "If-Unmodified-Since": before, "If-None-Match": '"snapshot"' }, 412],
  ["If-Match suppresses unmodified date", { "If-Match": '"snapshot"', "If-Unmodified-Since": before }, 200],
  ["If-None-Match suppresses modified date", { "If-None-Match": '"other"', "If-Modified-Since": after }, 200],
  ["invalid dates are ignored", { "If-Modified-Since": "nonsense", "If-Unmodified-Since": "nonsense" }, 200],
  ["non-HTTP date formats are ignored", { "If-Modified-Since": "2099-01-01", "If-Unmodified-Since": "0" }, 200],
];

describe.each([
  ["uncached GET", false, "GET"],
  ["cached GET", true, "GET"],
  ["uncached HEAD", false, "HEAD"],
  ["cached HEAD", true, "HEAD"],
])("Worker %s", (_, cached, method) => {
  it.each(conditions)("handles %s", async (_, headers, status) => {
    const f = fixture({ cached });
    const response = await f.fetch(headers, method);
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(status === 200 && method === "GET" ? payload : "");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("ETag")).toBe('"snapshot"');
    expect(response.headers.get("Last-Modified")).toBe(modified);
    expect(response.headers.get("Content-Length")).toBe(status === 412 ? null : String(payload.length));
    if (status === 412) expect(response.headers.get("Cache-Control")).toBe("no-store");
    const cacheRequest = f.cache.match.mock.calls[0][0];
    expect(cacheRequest.method).toBe("GET");
    expect([...cacheRequest.headers]).toEqual([]);
    if (cached) {
      expect(f.get).not.toHaveBeenCalled();
      expect(f.head).not.toHaveBeenCalled();
    } else if (method === "HEAD") {
      expect(f.head).toHaveBeenCalledWith("satellites.json");
      expect(f.get).not.toHaveBeenCalled();
    } else {
      expect(f.get).toHaveBeenCalledWith("satellites.json");
    }
    await f.settle();
    expect(f.cache.put).toHaveBeenCalledTimes(!cached && method === "GET" && status === 200 ? 1 : 0);
  });
});

describe("Worker errors and cache lifecycle", () => {
  it("caches a complete snapshot after a successful conditional GET", async () => {
    const f = fixture();
    expect(await (await f.fetch({ "If-None-Match": '"old"' })).text()).toBe(payload);
    await f.settle();
    expect((await f.fetch({ "If-None-Match": '"snapshot"' })).status).toBe(304);
    expect(await (await f.fetch()).text()).toBe(payload);
    expect(f.get).toHaveBeenCalledTimes(1);
  });

  it("supports quoted ETags containing commas", async () => {
    const f = fixture({ etag: '"part,tag"' });
    expect((await f.fetch({ "If-None-Match": '"other", W/"part,tag"' })).status).toBe(304);
    expect((await f.fetch({ "If-Match": '"other", "part,tag"' })).status).toBe(200);
    await f.settle();
  });

  it.each(["GET", "HEAD"])("returns a CORS client error for malformed %s paths", async method => {
    const f = fixture();
    const response = await f.fetch({}, method, "/%ZZ");
    expect(response.status).toBe(400);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    if (method === "HEAD") expect(await response.text()).toBe("");
    expect(f.get).not.toHaveBeenCalled();
    expect(f.head).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD"])("keeps missing %s objects as 404 before checking validators", async method => {
    const f = fixture({ missing: true });
    const response = await f.fetch({ "If-Match": "*" }, method);
    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    if (method === "HEAD") expect(await response.text()).toBe("");
  });

  it("permits cross-origin conditional requests and exposes validators", async () => {
    const f = fixture();
    const response = await f.fetch({ "Access-Control-Request-Headers": "If-None-Match" }, "OPTIONS");
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("If-None-Match");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Last-Modified");
  });

  it("keeps method and rejected-key errors readable across origins", async () => {
    const f = fixture();
    for (const [method, path, status] of [["POST", "/satellites.json", 405], ["GET", "/", 404], ["GET", "/a%2f..%2fb", 404]]) {
      const response = await f.fetch({}, method, path);
      expect(response.status).toBe(status);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });

  it.each(["GET", "HEAD"])("returns a retryable CORS error when storage fails for %s", async method => {
    const f = fixture();
    f.get.mockRejectedValue(new Error("internal bucket detail"));
    f.head.mockRejectedValue(new Error("internal bucket detail"));
    const response = await f.fetch({}, method);
    expect(response.status).toBe(503);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.text()).not.toContain("internal bucket detail");
  });

  it("serves storage when the optional edge cache fails", async () => {
    const f = fixture();
    f.cache.match.mockRejectedValue(new Error("cache unavailable"));
    f.cache.put.mockRejectedValue(new Error("cache full"));
    expect(await (await f.fetch()).text()).toBe(payload);
    await f.settle();
  });
});
