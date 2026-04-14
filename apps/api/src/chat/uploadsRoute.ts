import { Hono } from "hono";
import { nanoid } from "nanoid";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { getEvaluation } from "../db/queries.js";
import { validateUpload } from "./uploads.js";
import { insertChatUpload, getChatUpload } from "./storage.js";

const DATA_DIR = process.env.AEGIS_DATA_DIR || join(process.cwd(), ".data");

export const uploadsRoute = new Hono();

uploadsRoute.post("/:evaluationId", async (c) => {
  const evaluationId = c.req.param("evaluationId");
  if (!getEvaluation(evaluationId)) return c.json({ error: "Evaluation not found" }, 404);

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "file missing", code: "missing_file" }, 400);

  const buf = Buffer.from(await file.arrayBuffer());
  const result = await validateUpload(buf, file.name, file.type);
  if (!result.ok) return c.json({ error: result.message, code: result.code }, 400);

  const id = nanoid();
  const dir = join(DATA_DIR, "uploads", evaluationId);
  await mkdir(dir, { recursive: true });
  const storagePath = join(dir, `${id}${extname(file.name) || ""}`);
  await writeFile(storagePath, result.cleanedBuffer);

  insertChatUpload({
    id, evaluationId, originalName: file.name, mime: result.mime,
    sizeBytes: result.cleanedBuffer.byteLength, storagePath, createdAt: Date.now(),
  });
  return c.json({ id, name: file.name, mime: result.mime, size: result.cleanedBuffer.byteLength, url: `/api/uploads/${id}` });
});

uploadsRoute.get("/:id", async (c) => {
  const u = getChatUpload(c.req.param("id"));
  if (!u) return c.json({ error: "Not found" }, 404);
  const buf = await readFile(u.storagePath);
  c.header("Content-Type", u.mime);
  c.header("Content-Disposition", `inline; filename="${u.originalName.replace(/"/g, "")}"`);
  return c.body(buf);
});
