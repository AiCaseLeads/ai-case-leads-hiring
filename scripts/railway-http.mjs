import { Transform } from "node:stream";
import { isIP } from "node:net";

const MAX_FILE = 10 * 1024 * 1024;
const MAX_JSON = 512 * 1024;
export function normalizeRailwayRequest(request, origin, railwayEdge = !!process.env.RAILWAY_DEPLOYMENT_ID) {
  const site = new URL(origin);
  const realIp = typeof request.headers["x-real-ip"] === "string" ? request.headers["x-real-ip"].trim() : "";
  const socketIp = request.socket.remoteAddress || "";
  const clientIp = railwayEdge && isIP(realIp) ? realIp : isIP(socketIp) ? socketIp : "";
  for (const name of Object.keys(request.headers)) {
    if (name.startsWith("oai-") || name.startsWith("cf-") || name.startsWith("x-forwarded-") || name === "forwarded" || name === "x-real-ip") delete request.headers[name];
  }
  // Every application URL derives from configuration, never client Host/proxy input.
  request.headers.host = site.host;
  request.headers["x-forwarded-host"] = site.host;
  request.headers["x-forwarded-proto"] = site.protocol.slice(0, -1);
  if (clientIp) request.headers["cf-connecting-ip"] = clientIp;
}
function cacheBoundary(response, pathname) {
  const staticAsset = pathname.startsWith("/_next/static/");
  if (!staticAsset && !pathname.startsWith("/api/") && pathname !== "/team") return;
  const original = response.writeHead;
  response.writeHead = function(status, ...args) {
    const index = typeof args[0] === "string" ? 1 : 0;
    const input = args[index];
    let headers = Array.isArray(input) ? Object.fromEntries(Array.from({ length: input.length / 2 }, (_, n) => [input[n * 2], input[n * 2 + 1]])) : { ...input };
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === "cache-control" || (staticAsset && status >= 400 && ["etag", "last-modified"].includes(name.toLowerCase()))) delete headers[name];
    }
    headers = { ...headers, "Cache-Control": "no-store" };
    response.setHeader("Cache-Control", "no-store");
    if (staticAsset && status >= 400) { response.removeHeader("ETag"); response.removeHeader("Last-Modified"); }
    args[index] = headers;
    return original.call(this, status, ...args);
  };
}
function reject(response, code, status) {
  if (response.headersSent) { if (!response.writableEnded) response.destroy(); return; }
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify({ error: { code, message: "The request could not be processed." } }));
}
/** Streams through a byte cap before any framework action or route may buffer it. */
export function railwayRequestHandler(listeners, origin, legacyDomain = process.env.RAILWAY_PUBLIC_DOMAIN) {
  const canonical = new URL(origin);
  // Only Railway's explicitly configured public hostname is a migration alias.
  // Never derive a redirect destination from Host or forwarded headers.
  const legacyHost = typeof legacyDomain === "string" && /^[a-z0-9-]+\.up\.railway\.app$/i.test(legacyDomain)
    ? legacyDomain.toLowerCase() : null;
  return (request, response) => {
    const url = request.url || "/";
    if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\")) { reject(response, "invalid_request_target", 400); request.resume(); return; }
    const pathname = url.split("?")[0];
    cacheBoundary(response, pathname);
    const host = typeof request.headers.host === "string" ? request.headers.host.toLowerCase() : "";
    if (legacyHost && legacyHost !== canonical.host && host === legacyHost && pathname !== "/api/health") {
      if (!["GET", "HEAD"].includes(request.method || "GET")) {
        reject(response, "invalid_origin", 403); request.resume(); return;
      }
      response.writeHead(307, { Location: canonical.origin + url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      response.end(); request.resume(); return;
    }
    normalizeRailwayRequest(request, origin);
    const fileUpload = request.method === "POST" && /^\/api\/uploads\/[a-f0-9]{64}$/.test(pathname);
    const limit = fileUpload ? MAX_FILE + 65536 : MAX_JSON;
    const length = Number(request.headers["content-length"] || 0);
    if (!Number.isFinite(length) || length < 0 || length > limit) { reject(response, "request_too_large", 413); request.resume(); return; }
    let incoming = request;
    if (!["GET", "HEAD"].includes(request.method || "GET")) {
      let total = 0;
      const capped = new Transform({ transform(chunk, _encoding, done) {
        total += chunk.length;
        if (total > limit) { const error = new Error("request_too_large"); done(error); }
        else done(null, chunk);
      } });
      Object.assign(capped, { headers: request.headers, rawHeaders: request.rawHeaders, method: request.method, url: request.url, socket: request.socket });
      capped.on("error", () => { reject(response, "request_too_large", 413); request.unpipe(capped); request.resume(); });
      request.on("error", () => capped.destroy(new Error("request_stream_failed")));
      request.pipe(capped);
      incoming = capped;
    }
    for (const listener of listeners) {
      try { Promise.resolve(listener(incoming, response)).catch(() => reject(response, "request_failed", 503)); }
      catch { reject(response, "request_failed", 503); }
    }
  };
}
