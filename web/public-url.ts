/** Where the production PWA is served; override with PUBLIC_URL when building a self-hosted copy. */
export const DEFAULT_PUBLIC_URL = "https://tcgrass.duckdns.org";

/**
 * Replaces `%PUBLIC_URL%` in index.html. Link previews (Open Graph) need absolute URLs, and the
 * page is static, so the origin is filled in at build time.
 */
export function withPublicUrl(html: string, publicUrl: string | undefined): string {
  // Blank (e.g. `PUBLIC_URL=` copied from an env file) means unset.
  const configured = publicUrl?.trim() ? publicUrl.trim() : DEFAULT_PUBLIC_URL;
  const origin = new URL(configured).href.replace(/\/$/, "");
  return html.replaceAll("%PUBLIC_URL%", origin);
}
