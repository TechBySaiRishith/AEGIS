import { simpleGit, type SimpleGit } from "simple-git";
import { rm, access } from "node:fs/promises";

const CLONE_TIMEOUT_MS = 60_000;

/**
 * Shallow-clone a git repository into `targetDir`.
 *
 * - Uses `--depth 1` for speed.
 * - Aborts after 60 s.
 * - Cleans up the target directory on failure.
 */
export async function cloneRepo(
  url: string,
  targetDir: string,
): Promise<void> {
  validateGitUrl(url);

  const git: SimpleGit = simpleGit({ timeout: { block: CLONE_TIMEOUT_MS } });

  try {
    await git.clone(url, targetDir, ["--depth", "1", "--single-branch"]);
  } catch (err: unknown) {
    // Best-effort cleanup so partial clones don't litter the filesystem
    await cleanup(targetDir);

    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("Authentication") || message.includes("could not read Username")) {
      throw new Error(
        `Authentication failed for "${url}". If this is a private repo, set GITHUB_TOKEN.`,
      );
    }
    if (message.includes("not found") || message.includes("does not exist")) {
      throw new Error(`Repository not found: "${url}".`);
    }
    if (message.includes("timeout") || message.includes("timed out")) {
      throw new Error(
        `Clone timed out after ${CLONE_TIMEOUT_MS / 1000}s — the repository may be too large.`,
      );
    }

    throw new Error(`Failed to clone "${url}": ${message}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function validateGitUrl(url: string): void {
  const allowed =
    url.startsWith("https://") ||
    url.startsWith("http://") ||
    url.startsWith("git@");

  if (!allowed) {
    throw new Error(
      `Invalid repository URL: "${url}". Only HTTPS and SSH URLs are supported.`,
    );
  }
}

async function cleanup(dir: string): Promise<void> {
  try {
    await access(dir);
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Directory didn't exist or removal failed — nothing to do
  }
}
