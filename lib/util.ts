export function slugify(s: string) {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "x"
  );
}

/**
 * Where to go after sign-in, from the callbackUrl the middleware adds (a path
 * like "/games/g_123"). Only same-site paths are kept; full URLs,
 * protocol-relative "//host" and backslash tricks fall back to "/".
 */
export function safeCallbackPath(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return "/";
  if (v === "/login" || v.startsWith("/login?") || v.startsWith("/api/")) return "/";
  return v;
}
