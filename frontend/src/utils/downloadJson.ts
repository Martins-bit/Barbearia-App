import { JsonStreamValidator } from './jsonStreamValidator.ts'

export const PERSONAL_DATA_BLOB_FALLBACK_LIMIT_BYTES = 10 * 1024 * 1024
const BLOB_URL_REVOKE_DELAY_MS = 1_000

export class PersonalDataExportTooLargeError extends Error {
  constructor() {
    super('A exportação excede o limite de download deste navegador.')
    this.name = 'PersonalDataExportTooLargeError'
  }
}

export type PersonalDataDownloadPhase = 'choosing' | 'downloading'
export type PersonalDataDownloadResult = 'saved' | 'started'

interface SaveFilePickerOptions {
  suggestedName: string
  types: Array<{
    description: string
    accept: Record<string, string[]>
  }>
}

type SaveFileHandle = Pick<FileSystemFileHandle, 'createWritable'>
type SaveFilePicker = (
  options: SaveFilePickerOptions,
) => Promise<SaveFileHandle>

export function personalDataExportFilename(date = new Date()): string {
  return `barbearia-dados-pessoais-${date.toISOString().slice(0, 10)}.json`
}

function isSaveFilePicker(value: unknown): value is SaveFilePicker {
  return typeof value === 'function'
}

function getSaveFilePicker(): SaveFilePicker | undefined {
  if (typeof window === 'undefined') return undefined

  const candidate: unknown = Reflect.get(window, 'showSaveFilePicker')
  if (!isSaveFilePicker(candidate)) return undefined
  return candidate.bind(window)
}

function createAbortError(): Error {
  const error = new Error('A operação foi cancelada.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? createAbortError()
}

function validateJsonResponse(response: Response): ReadableStream<Uint8Array> {
  if (!response.ok) {
    throw new Error('O servidor não retornou o arquivo de exportação.')
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json') || response.body === null) {
    throw new Error('O servidor retornou uma resposta inválida para a exportação.')
  }

  return response.body
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  )
}

function isPickerUnavailableError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'SecurityError' || error.name === 'NotAllowedError')
  )
}

function rejectedCleanupErrors(
  results: PromiseSettledResult<void>[],
): unknown[] {
  return results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  )
}

async function writeResponseToFile(
  response: Response,
  handle: SaveFileHandle,
  signal: AbortSignal,
): Promise<void> {
  const reader = validateJsonResponse(response).getReader()
  const validator = new JsonStreamValidator()
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  let cleanup: Promise<PromiseSettledResult<void>[]> | null = null

  const cancelStreams = (reason: unknown) => {
    if (cleanup) return cleanup

    const operations: Promise<void>[] = [reader.cancel(reason)]
    if (writer) operations.push(writer.abort(reason))
    cleanup = Promise.allSettled(operations)
    return cleanup
  }
  const abortStreams = () => {
    void cancelStreams(signal.reason ?? createAbortError())
  }

  try {
    throwIfAborted(signal)
    writer = (await handle.createWritable()).getWriter()
    signal.addEventListener('abort', abortStreams, { once: true })
    throwIfAborted(signal)

    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      validator.write(value)
      await writer.write(value)
    }

    validator.finish()
    throwIfAborted(signal)
    await writer.close()
  } catch (error) {
    const cleanupResults = await cancelStreams(error)
    const cleanupErrors = rejectedCleanupErrors(cleanupResults)
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'A exportação falhou e não foi possível concluir toda a limpeza.',
      )
    }
    throw error
  } finally {
    signal.removeEventListener('abort', abortStreams)
    reader.releaseLock()
    writer?.releaseLock()
  }
}

function parseContentLength(response: Response): number | null {
  const value = response.headers.get('content-length')
  if (value === null || !/^\d+$/.test(value)) return null

  const length = Number(value)
  return Number.isSafeInteger(length) ? length : null
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  let link: HTMLAnchorElement | null = null

  try {
    link = document.createElement('a')
    link.href = url
    link.download = filename
    link.hidden = true
    document.body.append(link)
    link.click()
  } finally {
    link?.remove()
    window.setTimeout(
      () => URL.revokeObjectURL(url),
      BLOB_URL_REVOKE_DELAY_MS,
    )
  }
}

function blobPartFromChunk(chunk: Uint8Array): BlobPart {
  const buffer = chunk.buffer
  if (buffer instanceof ArrayBuffer) {
    if (chunk.byteOffset === 0 && chunk.byteLength === buffer.byteLength) {
      return buffer
    }
    return buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
  }

  const copy = new ArrayBuffer(chunk.byteLength)
  new Uint8Array(copy).set(chunk)
  return copy
}

async function downloadBoundedBlob(
  response: Response,
  filename: string,
  signal: AbortSignal,
): Promise<void> {
  const reader = validateJsonResponse(response).getReader()
  const validator = new JsonStreamValidator()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let cleanup: Promise<PromiseSettledResult<void>[]> | null = null

  const cancelReader = (reason: unknown) => {
    if (cleanup) return cleanup
    cleanup = Promise.allSettled([reader.cancel(reason)])
    return cleanup
  }
  const abortReader = () => {
    void cancelReader(signal.reason ?? createAbortError())
  }

  signal.addEventListener('abort', abortReader, { once: true })
  try {
    throwIfAborted(signal)
    const contentLength = parseContentLength(response)
    if (
      contentLength !== null &&
      contentLength > PERSONAL_DATA_BLOB_FALLBACK_LIMIT_BYTES
    ) {
      throw new PersonalDataExportTooLargeError()
    }

    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break

      validator.write(value)
      totalBytes += value.byteLength
      if (totalBytes > PERSONAL_DATA_BLOB_FALLBACK_LIMIT_BYTES) {
        throw new PersonalDataExportTooLargeError()
      }
      chunks.push(value)
    }

    validator.finish()
    throwIfAborted(signal)
    triggerBlobDownload(
      new Blob(chunks.map(blobPartFromChunk), { type: 'application/json' }),
      filename,
    )
  } catch (error) {
    const cleanupResults = await cancelReader(error)
    const cleanupErrors = rejectedCleanupErrors(cleanupResults)
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'A exportação falhou e não foi possível cancelar a leitura.',
      )
    }
    throw error
  } finally {
    signal.removeEventListener('abort', abortReader)
    reader.releaseLock()
  }
}

export function downloadJsonStream(
  request: (signal: AbortSignal) => Promise<Response>,
  filename: string,
  signal: AbortSignal,
  onPhase: (phase: PersonalDataDownloadPhase) => void = () => {},
): Promise<PersonalDataDownloadResult> {
  const picker = getSaveFilePicker()

  if (picker) {
    onPhase('choosing')
    const options: SaveFilePickerOptions = {
      suggestedName: filename,
      types: [
        {
          description: 'Arquivo JSON',
          accept: { 'application/json': ['.json'] },
        },
      ],
    }

    let handlePromise: Promise<SaveFileHandle>
    try {
      handlePromise = picker(options)
    } catch (error) {
      if (isAbortError(error) || !isPickerUnavailableError(error)) {
        return Promise.reject(error)
      }
      return downloadBlobFallback(request, filename, signal, onPhase)
    }

    return handlePromise.then(
      async (handle) => {
        throwIfAborted(signal)
        onPhase('downloading')
        const response = await request(signal)
        await writeResponseToFile(response, handle, signal)
        return 'saved' as const
      },
      (error: unknown) => {
        if (isAbortError(error) || !isPickerUnavailableError(error)) {
          throw error
        }
        return downloadBlobFallback(request, filename, signal, onPhase)
      },
    )
  }

  return downloadBlobFallback(request, filename, signal, onPhase)
}

function downloadBlobFallback(
  request: (signal: AbortSignal) => Promise<Response>,
  filename: string,
  signal: AbortSignal,
  onPhase: (phase: PersonalDataDownloadPhase) => void,
): Promise<PersonalDataDownloadResult> {
  onPhase('downloading')
  return (async () => {
    throwIfAborted(signal)
    const response = await request(signal)
    await downloadBoundedBlob(response, filename, signal)
    return 'started' as const
  })()
}
