// Browser-side helper. Contains NO secrets and makes NO decisions: it only calls
// our own API routes (cookies are sent automatically). The server decides everything.

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: { ...(init.body && !isForm ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const code = (data as { error?: string } | null)?.error ?? "error";
    throw new ApiError(res.status, code);
  }
  return data as T;
}

const MESSAGES: Record<string, string> = {
  unauthorized: "Please sign in again.",
  forbidden: "You are not allowed to do that.",
  account_disabled: "This account has been disabled.",
  not_found: "Not found, or you do not have access.",
  user_not_found: "No account with that email. They must sign in once first.",
  owner_already_has_access: "The owner already has full access.",
  file_required: "Choose a file first.",
  empty_file: "That file is empty.",
  file_too_large: "File is too large (maximum 4 MB).",
  unsupported_file_type: "Unsupported file type. Allowed: PDF, PNG, JPG, TXT, DOCX.",
  file_type_mismatch: "The file's real type does not match its name or the original file.",
  extension_must_match: "The new name must keep the right file extension.",
  invalid_file_name: "That file name is not valid.",
  invalid_body: "Please check the values you entered.",
  invalid_query: "Please check your filters.",
  cannot_modify_self: "You cannot change your own account.",
  conflict: "That changed while you were working. Please reload and try again.",
  bad_origin: "Request blocked for safety.",
  integrity_error: "The stored file failed its integrity check. It was not sent.",
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? `Something went wrong (${e.code}).`;
  return "Something went wrong. Please try again.";
}