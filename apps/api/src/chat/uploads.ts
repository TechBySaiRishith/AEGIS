import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { PDFParse } from "pdf-parse";
import { CHAT_LIMITS } from "@aegis/shared";
export { CHAT_LIMITS };

export type ValidationResult =
  | { ok: true; mime: string; cleanedBuffer: Buffer }
  | { ok: false; code: string; message: string };

export async function validateUpload(buf: Buffer, name: string, claimedMime: string): Promise<ValidationResult> {
  if (buf.byteLength > CHAT_LIMITS.maxFileBytes) {
    return { ok: false, code: "file_too_large", message: `File exceeds ${CHAT_LIMITS.maxFileBytes} bytes` };
  }
  const sniffed = await fileTypeFromBuffer(buf);
  const mime = sniffed?.mime ?? claimedMime;
  if (!(CHAT_LIMITS.allowedMimeTypes as readonly string[]).includes(mime)) {
    return { ok: false, code: "unsupported_mime", message: `MIME ${mime} not allowed` };
  }
  // PDF page-count check
  if (mime === "application/pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const info = await parser.getInfo().catch(() => null);
    if (!info) return { ok: false, code: "pdf_parse_failed", message: "Could not parse PDF" };
    if (info.total > CHAT_LIMITS.maxPdfPages) {
      return { ok: false, code: "pdf_too_many_pages", message: `PDF has ${info.total} pages (max ${CHAT_LIMITS.maxPdfPages})` };
    }
    return { ok: true, mime, cleanedBuffer: buf };
  }
  // Image: strip EXIF + enforce max dimension
  if (mime.startsWith("image/")) {
    const image = sharp(buf, { failOn: "error" });
    const meta = await image.metadata();
    if ((meta.width ?? 0) > CHAT_LIMITS.maxImagePixels || (meta.height ?? 0) > CHAT_LIMITS.maxImagePixels) {
      return { ok: false, code: "image_too_large", message: `Image exceeds ${CHAT_LIMITS.maxImagePixels}px` };
    }
    const cleaned = await image.rotate().toBuffer();
    return { ok: true, mime, cleanedBuffer: cleaned };
  }
  return { ok: false, code: "unsupported_mime", message: "Unsupported file" };
}
