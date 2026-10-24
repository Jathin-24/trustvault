import "server-only";
import { fileTypeFromBuffer } from "file-type";
import { HttpError } from "@/lib/http";
import { sha256Hex } from "@/lib/storage";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB (decision D4)
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 256 * 1024; // multipart overhead

/** The ONLY types we accept, and the extensions each may carry. */
export const ALLOWED_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "text/plain": ["txt"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
};

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/**
 * Makes a user-supplied file name safe to STORE AND DISPLAY.
 * (It is never used as a storage path: storage keys are random UUIDs.)
 * Removes: path parts, control characters, and the invisible "bidi" characters
 * that make "evil\u202Efdp.exe" look like "evilexe.pdf".
 */
export function cleanName(raw: string): string {
  let n = raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
  n = n.split(/[\\/]/).pop() ?? "";
  n = n.replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (n.length > 255) {
    const ext = extensionOf(n);
    n = n.slice(0, 250 - ext.length) + (ext ? "." + ext : "");
  }
  if (!n) throw new HttpError(400, "invalid_file_name");
  return n;
}

export function cleanCategory(raw: string | null | undefined): string {
  const c = (raw ?? "").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  if (!c) return "general";
  if (c.length > 50) throw new HttpError(400, "invalid_category");
  return c;
}

/**
 * What is this file REALLY? Decided from the file's own bytes ("magic bytes"),
 * never from the name or the browser-declared type.
 * Returns an allowed MIME type, or null.
 */
export async function detectMime(buf: Buffer): Promise<string | null> {
  const ft = await fileTypeFromBuffer(buf);
  if (ft) return ft.mime in ALLOWED_TYPES ? ft.mime : null;

  // No signature: only plain text is allowed to look like this. It must be valid
  // UTF-8 with no NUL bytes and no stray control characters.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
    return "text/plain";
  } catch {
    return null;
  }
}

export type ValidatedUpload = {
  buffer: Buffer;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  category: string;
};

/** Reads and fully validates a multipart upload with a `file` field. */
export async function readUpload(req: Request): Promise<ValidatedUpload> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_REQUEST_BYTES) throw new HttpError(413, "file_too_large");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "invalid_request");
  }

  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file_required");
  if (file.size === 0) throw new HttpError(400, "empty_file");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "file_too_large");

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) throw new HttpError(400, "empty_file");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "file_too_large");

  const name = cleanName(file.name);
  const category = cleanCategory(typeof form.get("category") === "string" ? (form.get("category") as string) : null);

  const mime = await detectMime(buffer);
  if (!mime) throw new HttpError(415, "unsupported_file_type");

  // The extension must agree with the real content (a .pdf that is really an
  // executable, or a .txt that is really a PDF, is refused).
  if (!ALLOWED_TYPES[mime].includes(extensionOf(name))) {
    throw new HttpError(400, "file_type_mismatch");
  }

  return { buffer, name, mime, size: buffer.length, sha256: sha256Hex(buffer), category };
}

/** Safe Content-Disposition for downloads (ASCII fallback + UTF-8 name). */
export function attachmentHeader(name: string, mime: string): string {
  const exts = ALLOWED_TYPES[mime] ?? [];
  const full = exts.includes(extensionOf(name)) || exts.length === 0 ? name : `${name}.${exts[0]}`;
  const ascii = full.replace(/[^A-Za-z0-9._-]/g, "_");
  const utf8 = encodeURIComponent(full).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}