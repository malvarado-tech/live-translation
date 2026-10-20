/**
 * Path prefix when the app is served under a sub-path (a static export of
 * the replay hosted inside another site). Next.js adds it to links and
 * bundled assets on its own; files fetched by hand from public/ and URLs
 * shown to people need it added here. Empty for a normal deployment.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
