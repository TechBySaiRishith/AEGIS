import type { RouteInfo } from "@aegis/shared";
import { scanSourceFiles } from "./patterns.js";

// ─── Route Detection ─────────────────────────────────────────

const ROUTE_PATTERNS: Array<{ regex: RegExp; type: string }> = [
  // Flask: @app.route("/path", methods=["GET", "POST"])
  { regex: /@app\.route\(\s*["']([^"']+)["'](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?\s*\)/g, type: "flask" },
  // Flask: @blueprint.route(...)
  { regex: /@\w+\.route\(\s*["']([^"']+)["'](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?\s*\)/g, type: "flask" },
  // FastAPI: @app.get("/path"), @app.post("/path")
  { regex: /@app\.(get|post|put|delete|patch)\(\s*["']([^"']+)["']/g, type: "fastapi" },
  // Express: app.get("/path", ...), router.post("/path", ...)
  { regex: /(?:app|router)\.(get|post|put|delete|patch|all)\(\s*["']([^"']+)["']/g, type: "express" },
];

export async function detectRoutes(repoDir: string, framework: string): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  await scanSourceFiles(repoDir, repoDir, (relPath, content) => {
    const lines = content.split("\n");

    for (const { regex, type } of ROUTE_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        // Find line number
        const beforeMatch = content.slice(0, match.index);
        const lineNum = beforeMatch.split("\n").length;

        if (type === "flask") {
          const routePath = match[1];
          const methodsRaw = match[2];
          const methods = methodsRaw
            ? methodsRaw.replace(/["'\s]/g, "").split(",")
            : ["GET"];

          // Find the handler function name (next def line)
          for (let i = lineNum; i < Math.min(lineNum + 3, lines.length); i++) {
            const defMatch = lines[i]?.match(/def\s+(\w+)/);
            if (defMatch) {
              for (const method of methods) {
                routes.push({
                  method: method.toUpperCase(),
                  path: routePath,
                  file: relPath,
                  handler: defMatch[1],
                });
              }
              break;
            }
          }

          if (routes.length === 0 || routes[routes.length - 1].path !== routePath) {
            for (const method of methods) {
              routes.push({ method: method.toUpperCase(), path: routePath, file: relPath });
            }
          }
        } else if (type === "fastapi") {
          routes.push({
            method: match[1].toUpperCase(),
            path: match[2],
            file: relPath,
          });
        } else if (type === "express") {
          routes.push({
            method: match[1].toUpperCase(),
            path: match[2],
            file: relPath,
          });
        }
      }
    }
  });

  // Deduplicate routes
  const seen = new Set<string>();
  return routes.filter((r) => {
    const key = `${r.method}:${r.path}:${r.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
