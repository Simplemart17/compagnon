/**
 * Sliding window rate limiter for Supabase Edge Functions.
 *
 * Uses in-memory storage — effective for single-instance deployments.
 * For multi-instance or high-traffic scenarios, replace with Upstash Redis.
 */

interface RateLimitWindow {
  requests: number[];
}

const windows = new Map<string, RateLimitWindow>();
let lastCleanup = Date.now();

/** Remove stale windows to prevent unbounded memory growth. */
function cleanup(windowMs: number): void {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60 * 1000) return; // only every 5 minutes

  for (const [key, window] of windows.entries()) {
    window.requests = window.requests.filter((t) => now - t < windowMs);
    if (window.requests.length === 0) windows.delete(key);
  }
  lastCleanup = now;
}

/**
 * Check whether the given userId is within their rate limit.
 *
 * @param userId       - Unique user identifier (from Supabase auth)
 * @param limit        - Maximum number of requests allowed per window
 * @param windowSeconds - Sliding window duration in seconds
 */
export function checkRateLimit(
  userId: string,
  limit: number,
  windowSeconds: number
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  cleanup(windowMs);

  let window = windows.get(userId);
  if (!window) {
    window = { requests: [] };
    windows.set(userId, window);
  }

  // Evict requests outside the current sliding window
  window.requests = window.requests.filter((t) => now - t < windowMs);

  if (window.requests.length >= limit) {
    const oldest = window.requests[0];
    const resetIn = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, resetIn };
  }

  window.requests.push(now);
  return {
    allowed: true,
    remaining: limit - window.requests.length,
    resetIn: windowSeconds,
  };
}

/** Build a 429 Too Many Requests response. */
export function rateLimitResponse(
  corsHeaders: Record<string, string>,
  resetIn: number
): Response {
  return new Response(
    JSON.stringify({
      error: "Too many requests. Please wait before trying again.",
      code: "RATE_LIMITED",
      retryAfter: resetIn,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(resetIn),
      },
    }
  );
}
