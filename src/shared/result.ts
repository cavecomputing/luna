/**
 * Every IPC handler returns a Result. Nothing throws across the process
 * boundary — a rejected `invoke` loses the error type and leaks stack traces
 * into the renderer.
 */

export type Ok<T> = { ok: true; value: T }
export type Err = { ok: false; code: string; message: string }
export type Result<T> = Ok<T> | Err

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

/**
 * `code` is stable and switchable ('file/not-found'). `message` is for logs
 * only and must never contain a path, a key, or user content.
 */
export function err(code: string, message: string): Err {
  return { ok: false, code, message }
}

export function isOk<T>(r: Result<T>): r is Ok<T> {
  return r.ok
}
