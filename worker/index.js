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

function withCors(headers) {
    // The page is served from a different origin than this Worker, so every
    // response needs CORS or the browser discards it.
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Expose-Headers", "Content-Length, ETag");
    return headers;
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, {status: 204, headers: withCors(new Headers({
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Access-Control-Max-Age": "86400"
            }))});
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("method not allowed\n",
                {status: 405, headers: {"Allow": "GET, HEAD, OPTIONS"}});
        }

        const url = new URL(request.url);
        const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
        if (!key || key.includes("..")) return new Response("not found\n", {status: 404});

        function finish(headers) {
            headers.set("Cache-Control", headers.get("Cache-Control") || FALLBACK_CACHE_CONTROL);
            return withCors(headers);
        }

        // HEAD is answered from metadata alone. Going through the GET path would
        // build a response around the object stream and then discard it,
        // leaving the body dangling.
        if (request.method === "HEAD") {
            const meta = await env.BUCKET.head(key);
            if (meta === null) return new Response("not found\n", {status: 404});
            const headers = new Headers();
            meta.writeHttpMetadata(headers);
            headers.set("ETag", meta.httpEtag);
            headers.set("Content-Length", String(meta.size));
            return new Response(null, {status: 200, headers: finish(headers)});
        }

        const cache = caches.default;
        // Keyed by URL alone. Stored bodies are unencoded, so there is no
        // encoding to key on; the edge holds its own variant per encoding.
        const hit = await cache.match(request);
        if (hit) return hit;

        const object = await env.BUCKET.get(key, {onlyIf: request.headers});
        if (object === null) return new Response("not found\n", {status: 404});

        const headers = new Headers();
        object.writeHttpMetadata(headers);   // content-type, -encoding, cache-control
        headers.set("ETag", object.httpEtag);
        finish(headers);

        // A conditional request R2 satisfied comes back with no body.
        if (!object.body) return new Response(null, {status: 304, headers});

        const response = new Response(object.body, {status: 200, headers});
        // clone() tees the stream: one copy to the edge cache, one to the
        // client, so a multi-megabyte object is never buffered in the isolate.
        ctx.waitUntil(cache.put(request, response.clone()));
        return response;
    }
};
