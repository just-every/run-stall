import { fail } from './model'

/** The request body as bytes, refused once it passes `limit`. */
export async function rawBytes(request: Pick<Request, 'headers' | 'body'>, limit: number): Promise<Uint8Array> {
 if (Number(request.headers.get('content-length') ?? 0) > limit) fail('FILE_SIZE', `A file may be at most ${limit} bytes.`, 413)
 const reader = request.body?.getReader()
 if (!reader) fail('FILE_EMPTY', 'Send the file as the request body.', 400)
 const chunks: Uint8Array[] = []
 let size = 0
 while (true) {
  const { done, value } = await reader.read()
  if (done) break
  size += value.byteLength
  if (size > limit) { await reader.cancel(); fail('FILE_SIZE', `A file may be at most ${limit} bytes.`, 413) }
  chunks.push(value)
 }
 if (!size) fail('FILE_EMPTY', 'The file is empty.', 400)
 const bytes = new Uint8Array(size)
 let offset = 0
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
 return bytes
}
const starts = (bytes: Uint8Array, at: number, text: string) => [...text].every((char, index) => bytes[at + index] === char.charCodeAt(0))
/** The type a file's own bytes show; a declared type must agree with it. */
export function sniff(bytes: Uint8Array): string | null {
 if (bytes[0] === 0x89 && starts(bytes, 1, 'PNG\r\n')) return 'image/png'
 if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
 if (starts(bytes, 0, 'GIF87a') || starts(bytes, 0, 'GIF89a')) return 'image/gif'
 if (starts(bytes, 0, 'RIFF') && starts(bytes, 8, 'WEBP')) return 'image/webp'
 if (starts(bytes, 0, '%PDF-')) return 'application/pdf'
 if (starts(bytes, 4, 'ftyp')) return 'video/mp4'
 if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm'
 return null
}
export function encode(bytes: Uint8Array) { let out = ''; for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(out) }
export function decode(data: string) { const text = atob(data), bytes = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i); return bytes }
export const safeName = (name: string | null) => (name ?? '').replace(/[^\w. -]/g, '').slice(0, 100) || 'file'
export const fileHeaders = (mime: string, extra: Record<string, string> = {}) => ({ 'content-type': mime, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer', ...extra })
