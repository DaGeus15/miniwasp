import { AttachmentKind } from '../../shared/attachments.js';
import { parseByteRange } from '../http/byte-range.js';

// Un archivo subido nunca se interpreta como pagina: sin scripts, sin formularios, sin
// navegacion y aislado en su propio origen opaco (sandbox).
const ATTACHMENT_CSP = "default-src 'none'; sandbox";
const PRIVATE_NO_STORE = 'private, no-cache, no-store, must-revalidate';
// Imagenes y audio se muestran dentro del chat; los documentos solo se descargan, para que
// un PDF nunca se abra dentro del origen de MiniWasp.
const INLINE_KINDS = new Set([AttachmentKind.IMAGE, AttachmentKind.AUDIO]);

function contentDisposition(attachment) {
  const disposition = INLINE_KINDS.has(attachment.kind) ? 'inline' : 'attachment';
  return `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`;
}

function baseHeaders(attachment) {
  return {
    'Content-Type': attachment.mimeType,
    'Content-Disposition': contentDisposition(attachment),
    'Content-Security-Policy': ATTACHMENT_CSP,
    'Cache-Control': PRIVATE_NO_STORE,
    'Accept-Ranges': 'bytes',
  };
}

// Responde un adjunto completo (200), una parte (206) o un rango imposible (416).
export function sendAttachment({ request, response, responder, attachment, bytes }) {
  const headers = baseHeaders(attachment);
  const range = parseByteRange(request.headers.range, bytes.length);
  if (!range) {
    responder.file(response, 200, { ...headers, 'Content-Length': bytes.length }, bytes);
    return;
  }
  if (!range.isSatisfiable) {
    responder.file(response, 416, { ...headers, 'Content-Range': `bytes */${bytes.length}` });
    return;
  }
  const part = bytes.subarray(range.start, range.end + 1);
  responder.file(
    response,
    206,
    { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}`, 'Content-Length': part.length },
    part,
  );
}
