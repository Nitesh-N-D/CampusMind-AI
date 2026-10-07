import { useEffect } from "react";

const SITE_ORIGIN = "https://campus-mind-ai-delta.vercel.app";
const SUFFIX = "CampusMind AI";

interface PageMeta {
  /** Page name; shown as "<title> — CampusMind AI". Omit for the home page. */
  title?: string;
  description?: string;
  /** Canonical path on the production site, e.g. "/privacy". */
  path?: string;
  /** Private or utility pages: ask search engines not to index them. */
  noindex?: boolean;
  /** Emit no canonical URL at all (e.g. the 404 page, which has no canonical address). */
  noCanonical?: boolean;
}

function metaTag(name: string): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
}

/**
 * Per-route <title>, description, canonical and robots, set at runtime. The
 * static values in index.html stay as the defaults (and are what crawlers that
 * don't run JavaScript see); this restores them when the page unmounts, so a
 * page that doesn't call the hook never inherits the previous page's values.
 */
export function usePageMeta({ title, description, path, noindex, noCanonical }: PageMeta) {
  useEffect(() => {
    const description$ = metaTag("description");
    const robots = metaTag("robots");
    const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const previous = {
      title: document.title,
      description: description$?.content,
      robots: robots?.content,
      canonical: canonical?.href,
    };

    if (title) document.title = `${title} — ${SUFFIX}`;
    if (description && description$) description$.content = description;
    if (noindex && robots) robots.content = "noindex, nofollow";
    if (path && canonical) canonical.href = SITE_ORIGIN + path;
    const canonicalParent = canonical?.parentNode;
    if (noCanonical) canonical?.remove();

    return () => {
      if (noCanonical && canonical) canonicalParent?.appendChild(canonical);
      document.title = previous.title;
      if (description$ && previous.description !== undefined) description$.content = previous.description;
      if (robots && previous.robots !== undefined) robots.content = previous.robots;
      if (canonical && previous.canonical !== undefined) canonical.href = previous.canonical;
    };
  }, [title, description, path, noindex, noCanonical]);
}
