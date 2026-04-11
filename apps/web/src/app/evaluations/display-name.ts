import type { Evaluation } from "@aegis/shared";

function extractRepoName(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "github.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    }
    return parsed.hostname + parsed.pathname;
  } catch {
    return url;
  }
}

/** Extract a human-readable label from the evaluation's application name or source URL. */
export function displayName(evaluation: Evaluation): string {
  const name = evaluation.application?.name?.trim();
  const sourceUrl = evaluation.application?.sourceUrl;

  if (name && /^https?:\/\//.test(name)) {
    return extractRepoName(name);
  }

  if (name && name.length > 3 && !/^[A-Za-z0-9_-]{10,}$/.test(name)) {
    return name;
  }

  if (sourceUrl) {
    return extractRepoName(sourceUrl);
  }

  return name || "Untitled evaluation";
}
