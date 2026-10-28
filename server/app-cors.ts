// The installed iPhone shell is a different origin even when it calls the public PC URL.
export const APP_ORIGINS = new Set(["capacitor://localhost", "ionic://localhost", "https://localhost", "http://localhost"]);

export function appCors(req: Request, response: Response): Response {
  const origin = req.headers.get("origin") ?? "";
  if (APP_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Expose-Headers", "ETag");
  }
  // Include Vary even for unrecognised origins, so caches cannot reuse another origin's response.
  response.headers.append("Vary", "Origin");
  return response;
}

export function appPreflight(req: Request): Response {
  const allowed = APP_ORIGINS.has(req.headers.get("origin") ?? "");
  return appCors(req, new Response(null, { status: allowed ? 204 : 403, headers: allowed ? {
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PATCH, PUT, DELETE",
    // If-None-Match: the app revalidates its copy of /bootstrap (304 when nothing changed)
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Client, Idempotency-Key, If-None-Match",
    "Access-Control-Max-Age": "86400",
  } : {} }));
}
