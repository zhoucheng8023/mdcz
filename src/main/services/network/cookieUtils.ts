export const normalizeCookieDomain = (domain: string): string => domain.replace(/^\./u, "").trim().toLowerCase();

export const normalizeCookiePath = (path: string | undefined, fallbackPath = "/"): string => {
  const trimmed = path?.trim();
  if (!trimmed) {
    return fallbackPath;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

export const cookieDomainMatches = (host: string, domain: string): boolean => {
  return host === domain || host.endsWith(`.${domain}`);
};

export const cookiePathMatches = (requestPath: string, cookiePath: string): boolean => {
  if (requestPath === cookiePath) {
    return true;
  }
  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }
  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/";
};
