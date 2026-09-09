export const buildRendererContentSecurityPolicy = (
  rendererUrl?: string,
  delivery: "header" | "meta" = "header",
): string => {
  const configured = rendererUrl?.trim();
  const scriptSources = ["'self'"];
  const connectSources = ["'self'"];
  if (configured) {
    const origin = new URL(configured).origin;
    scriptSources.push(origin);
    connectSources.push(origin, origin.replace(/^http/u, "ws"));
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    ...(delivery === "header" ? ["frame-ancestors 'none'"] : []),
    "form-action 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    "img-src 'self' local-file: data: blob: http: https:",
    "media-src 'self' local-file: blob: http: https:",
  ].join("; ");
};
