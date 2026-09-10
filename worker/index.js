/**
 * sky-data — a Cloudflare Worker in front of the R2 bucket holding Starmap's
 * refreshed orbital elements.
 *
 * Why it exists. The browser reads the published snapshot directly, so this is
 * the hot path for every page load. A bucket's built-in r2.dev endpoint is
 * HTTP/1.1, is not edge cached, and Cloudflare documents it as rate limited and
 * not for production; through a Worker the same object comes back over h2/h3
 * from a cache close to the reader, and workers.dev needs no domain.
 *
 * Why objects are stored uncompressed. The edge negotiates br, zstd or gzip per
 * client and caches a variant for each. Storing an already-compressed body and
 * declaring Content-Encoding fights that: the runtime has no brotli
 * decompressor, so a Worker cannot hand the edge something it is willing to
 * re-encode, and the combinations end with clients receiving compressed bytes
 * labelled application/json. Plain JSON in, compressed on the wire out.
 *
 * Everything in this bucket is refreshed on a schedule, so the fallback cache
 * policy is deliberately short. A bucket that also held immutable assets would
 * want to distinguish them by key; this one must not, because a long default
 * here would pin a refreshing dataset in caches until its URL changed.
 */

const FALLBACK_CACHE_CONTROL = "public, max-age=1800, must-revalidate";
const CONDITIONAL_HEADERS = "If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since";

function withCors(headers) {
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Expose-Headers", "Content-Length, ETag, Last-Modified");
    return headers;
}

function errorResponse(request, status, message, extra = {}) {
    return new Response(request.method === "HEAD" ? null : `${message}\n`, {
        status,
        headers: withCors(new Headers({"Cache-Control": "no-store", ...extra}))
    });
}

function objectHeaders(object) {
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Content-Length", String(object.size));
    headers.set("Last-Modified", object.uploaded.toUTCString());
    headers.set("Cache-Control", headers.get("Cache-Control") || FALLBACK_CACHE_CONTROL);
    return withCors(headers);
}

function matchesEtag(value, etag, weak) {
    if (value.trim() === "*") return true;
    // A quoted tag can contain commas. Splitting on commas would misparse it.
    const tags = value.match(/(?:W\/)?"[^"\x00-\x20\x7f]*"/g) || [];
    return tags.some(tag => weak
        ? tag.replace(/^W\//, "") === etag?.replace(/^W\//, "")
        : !tag.startsWith("W/") && tag === etag);
}

function httpDate(value) {
    // Date.parse also accepts non-HTTP values such as "0" and ISO dates.
    // Accept the three HTTP-date formats; invalid dates are ignored.
    if (!value || !/^(?:[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Z][a-z]+, \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Z][a-z]{2} [A-Z][a-z]{2} (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4})$/.test(value))
        return NaN;
    return Date.parse(value);
}

function conditionalStatus(request, headers) {
    const etag = headers.get("ETag");
    const modified = httpDate(headers.get("Last-Modified"));
    // RFC 9110 §13.2.2: If-Match precedes If-None-Match, and each
    // ETag condition takes precedence over its corresponding date condition.
    const match = request.headers.get("If-Match");
    if (match !== null) {
        if (!matchesEtag(match, etag, false)) return 412;
    } else if (modified > httpDate(request.headers.get("If-Unmodified-Since"))) {
        return 412;
    }
    const none = request.headers.get("If-None-Match");
    if (none !== null) {
        if (matchesEtag(none, etag, true)) return 304;
    } else if (modified <= httpDate(request.headers.get("If-Modified-Since"))) {
        return 304;
    }
    return 200;
}

function respond(request, headers, body, ctx) {
    const status = conditionalStatus(request, headers);
    if (status !== 200 || request.method === "HEAD") {
        // R2 and cache bodies are streams. Cancel unused bodies without buffering
        // them, including a cached GET used to answer HEAD.
        if (body) ctx.waitUntil(body.cancel().catch(() => {}));
        if (status === 412) {
            headers.delete("Content-Length");
            headers.set("Cache-Control", "no-store");
        }
        return new Response(null, {status, headers});
    }
    return new Response(body, {status, headers});
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, {status: 204, headers: withCors(new Headers({
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers": CONDITIONAL_HEADERS,
                "Access-Control-Max-Age": "86400"
            }))});
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
            return errorResponse(request, 405, "method not allowed", {"Allow": "GET, HEAD, OPTIONS"});
        }

        const url = new URL(request.url);
        let key;
        try {
            key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
        } catch {
            return errorResponse(request, 400, "malformed object path");
        }
        if (!key || key.includes("..")) return errorResponse(request, 404, "not found");

        // The cache must return a complete GET so the same precondition rules
        // apply on every path. Forwarding request headers would let cache.match
        // turn a result into 304 before we evaluate a failing If-Match.
        const cache = caches.default;
        const cacheKey = new Request(url.toString(), {method: "GET"});
        const hit = await cache.match(cacheKey).catch(() => undefined);
        if (hit) return respond(request, withCors(new Headers(hit.headers)), hit.body, ctx);

        try {
            // HEAD reads metadata only. GET conditions are evaluated against the
            // exact streamed representation, avoiding a head/get update race and
            // R2's bodyless result (which does not distinguish 304 from 412).
            const object = request.method === "HEAD"
                ? await env.BUCKET.head(key)
                : await env.BUCKET.get(key);
            if (object === null) return errorResponse(request, 404, "not found");
            const response = respond(request, objectHeaders(object), object.body, ctx);
            if (request.method === "GET" && response.status === 200) {
                ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
            }
            return response;
        } catch {
            return errorResponse(request, 503, "object storage unavailable", {"Retry-After": "60"});
        }
    }
};
