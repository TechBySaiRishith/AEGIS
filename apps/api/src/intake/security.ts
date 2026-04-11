import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SecurityProfile, DataHandlingPattern } from "@aegis/shared";
import { exists, scanSourceFiles, scanTemplateFiles } from "./patterns.js";

// ─── Security Pattern Constants ──────────────────────────────

const AUTH_PATTERNS = [
  /login_required/i,
  /@login_required/i,
  /flask[_-]?login/i,
  /flask[_-]?security/i,
  /flask[_-]?jwt/i,
  /passport\.authenticate/i,
  /requireAuth/i,
  /isAuthenticated/i,
  /jwt\.verify/i,
  /auth_required/i,
  /permission_required/i,
  /from\s+django\.contrib\.auth/i,
  /Depends\(.*auth/i,
  /session\[['"]user/i,
  /@requires_auth/i,
  /flask_httpauth/i,
];

const FILE_UPLOAD_PATTERNS = [
  /request\.files/i,
  /FileField/i,
  /UploadFile/i,
  /multer/i,
  /file\.save\(/i,
  /secure_filename/i,
  /upload/i,
  /enctype.*multipart/i,
  /form.*file/i,
];

const RATE_LIMIT_PATTERNS = [
  /flask[_-]?limiter/i,
  /rate[_-]?limit/i,
  /throttle/i,
  /express[_-]?rate[_-]?limit/i,
  /slowapi/i,
  /RateLimiter/i,
];

const CSRF_PATTERNS = [
  /csrf/i,
  /CSRFProtect/i,
  /flask[_-]?wtf/i,
  /csurf/i,
  /@csrf_exempt/i,
];

const INPUT_VALIDATION_PATTERNS = [
  /wtforms/i,
  /pydantic/i,
  /marshmallow/i,
  /joi\./i,
  /zod\./i,
  /validator/i,
  /sanitize/i,
  /escape\(/i,
  /bleach/i,
];

const CORS_PATTERNS = [
  /flask[_-]?cors/i,
  /CORS\(/i,
  /cors\(/i,
  /Access-Control-Allow/i,
];

const DEBUG_PATTERNS = [
  /debug\s*=\s*True/i,
  /DEBUG\s*=\s*True/i,
  /app\.run\(.*debug\s*=\s*True/i,
  /\.env.*DEBUG/i,
];

// ─── Security Profile Detection ──────────────────────────────

export async function detectSecurityProfile(
  repoDir: string,
  deps: string[],
): Promise<SecurityProfile> {
  const profile: SecurityProfile = {
    hasAuthentication: false,
    hasFileUpload: false,
    hasRateLimiting: false,
    hasCSRFProtection: false,
    hasInputValidation: false,
    hasCORS: false,
    debugModeEnabled: false,
    findings: [],
  };

  const depsLower = new Set(deps.map((d) => d.toLowerCase()));

  // Check deps for security libraries
  if (depsLower.has("flask-login") || depsLower.has("flask-security") ||
      depsLower.has("flask-jwt-extended") || depsLower.has("passport") ||
      depsLower.has("flask-httpauth")) {
    profile.hasAuthentication = true;
  }
  if (depsLower.has("flask-limiter") || depsLower.has("express-rate-limit") ||
      depsLower.has("slowapi")) {
    profile.hasRateLimiting = true;
  }
  if (depsLower.has("flask-wtf") || depsLower.has("csurf")) {
    profile.hasCSRFProtection = true;
  }
  if (depsLower.has("flask-cors") || depsLower.has("cors")) {
    profile.hasCORS = true;
  }

  await scanSourceFiles(repoDir, repoDir, (relPath, content) => {
    if (AUTH_PATTERNS.some((p) => p.test(content))) profile.hasAuthentication = true;
    if (FILE_UPLOAD_PATTERNS.some((p) => p.test(content))) profile.hasFileUpload = true;
    if (RATE_LIMIT_PATTERNS.some((p) => p.test(content))) profile.hasRateLimiting = true;
    if (CSRF_PATTERNS.some((p) => p.test(content))) profile.hasCSRFProtection = true;
    if (INPUT_VALIDATION_PATTERNS.some((p) => p.test(content))) profile.hasInputValidation = true;
    if (CORS_PATTERNS.some((p) => p.test(content))) profile.hasCORS = true;
    if (DEBUG_PATTERNS.some((p) => p.test(content))) profile.debugModeEnabled = true;
  });

  // Also check HTML templates for file upload forms
  await scanTemplateFiles(repoDir, (_relPath, content) => {
    if (/enctype\s*=\s*["']multipart\/form-data["']/i.test(content)) {
      profile.hasFileUpload = true;
    }
    if (/type\s*=\s*["']file["']/i.test(content)) {
      profile.hasFileUpload = true;
    }
  });

  // Generate findings based on what's missing
  if (!profile.hasAuthentication) {
    profile.findings.push("No authentication mechanism detected — all endpoints appear publicly accessible.");
  }
  if (profile.hasFileUpload && !profile.hasInputValidation) {
    profile.findings.push("File upload functionality detected without robust input validation library.");
  }
  if (!profile.hasRateLimiting) {
    profile.findings.push("No rate limiting detected — API endpoints may be vulnerable to abuse.");
  }
  if (!profile.hasCSRFProtection) {
    profile.findings.push("No CSRF protection detected on form submissions.");
  }
  if (profile.debugModeEnabled) {
    profile.findings.push("Debug mode appears to be enabled — exposes stack traces and internal state.");
  }
  if (!profile.hasCORS) {
    profile.findings.push("No CORS configuration detected.");
  }

  return profile;
}

// ─── Environment Variable Detection ──────────────────────────

const ENV_PATTERNS = [
  /os\.(?:environ|getenv)\(?['"]([A-Z_][A-Z0-9_]+)['"]/g,
  /process\.env\.([A-Z_][A-Z0-9_]+)/g,
  /os\.environ\[['"]([A-Z_][A-Z0-9_]+)['"]\]/g,
  /os\.environ\.get\(['"]([A-Z_][A-Z0-9_]+)['"]/g,
];

export async function detectEnvironmentVariables(repoDir: string): Promise<string[]> {
  const envVars = new Set<string>();

  // Parse .env.example / .env.sample
  for (const envFile of [".env.example", ".env.sample", ".env.template"]) {
    const envPath = path.join(repoDir, envFile);
    if (await exists(envPath)) {
      try {
        const content = await readFile(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            if (/^[A-Z_][A-Z0-9_]*$/.test(key)) envVars.add(key);
          }
        }
      } catch { /* ignore */ }
    }
  }

  // Scan source files for env var references
  await scanSourceFiles(repoDir, repoDir, (_relPath, content) => {
    for (const pattern of ENV_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        envVars.add(match[1]);
      }
    }
  });

  return [...envVars].sort();
}

// ─── Data Handling Detection ─────────────────────────────────

export async function detectDataHandling(repoDir: string): Promise<DataHandlingPattern[]> {
  const patterns: DataHandlingPattern[] = [];
  const fileUploadFiles: string[] = [];
  const mediaProcessingFiles: string[] = [];
  const databaseFiles: string[] = [];
  const piiFiles: string[] = [];
  const storageFiles: string[] = [];

  await scanSourceFiles(repoDir, repoDir, (relPath, content) => {
    // File upload handling
    if (/request\.files|FileField|UploadFile|multer|file\.save|secure_filename/i.test(content)) {
      fileUploadFiles.push(relPath);
    }
    // Media processing (audio, video, image)
    if (/moviepy|pydub|ffmpeg|AudioSegment|VideoFileClip|PIL|Pillow|imageio|cv2|whisper/i.test(content)) {
      mediaProcessingFiles.push(relPath);
    }
    // Database operations
    if (/sqlite|sqlalchemy|pymongo|psycopg|mysql|redis|database|\.execute\(|\.query\(/i.test(content)) {
      databaseFiles.push(relPath);
    }
    // PII/personal data handling
    if (/email|password|user_?name|phone|address|ssn|credit.?card|personal/i.test(content) &&
        /store|save|log|write|insert|upload/i.test(content)) {
      piiFiles.push(relPath);
    }
    // File storage/disk writes
    if (/tempfile|NamedTemporaryFile|open\(.*['"]w/i.test(content) ||
        /os\.makedirs|os\.path\.join.*upload/i.test(content)) {
      storageFiles.push(relPath);
    }
  });

  if (fileUploadFiles.length > 0) {
    patterns.push({
      type: "file_upload",
      description: "Application accepts file uploads from users (documents, media files). Potential vectors for malicious file injection.",
      files: [...new Set(fileUploadFiles)],
    });
  }
  if (mediaProcessingFiles.length > 0) {
    patterns.push({
      type: "media_processing",
      description: "Application processes media content (audio/video/images) using external libraries. Potential for processing of malicious media files.",
      files: [...new Set(mediaProcessingFiles)],
    });
  }
  if (databaseFiles.length > 0) {
    patterns.push({
      type: "database",
      description: "Application performs database operations. Check for SQL injection and data exposure.",
      files: [...new Set(databaseFiles)],
    });
  }
  if (piiFiles.length > 0) {
    patterns.push({
      type: "pii_handling",
      description: "Application appears to handle personally identifiable information (emails, usernames, etc.).",
      files: [...new Set(piiFiles)],
    });
  }
  if (storageFiles.length > 0) {
    patterns.push({
      type: "local_storage",
      description: "Application writes files to local disk (temporary files, uploads). Check for path traversal and cleanup.",
      files: [...new Set(storageFiles)],
    });
  }

  return patterns;
}
