import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  downloadJsonStream,
  PERSONAL_DATA_BLOB_FALLBACK_LIMIT_BYTES,
  PersonalDataExportTooLargeError,
  personalDataExportFilename,
} from './downloadJson.ts'
import { JsonStreamValidationError } from './jsonStreamValidator.ts'

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'window',
)
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'document',
)
const originalCreateObjectUrl = URL.createObjectURL
const originalRevokeObjectUrl = URL.revokeObjectURL

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
  if (originalDocumentDescriptor) {
    Object.defineProperty(globalThis, 'document', originalDocumentDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }
  URL.createObjectURL = originalCreateObjectUrl
  URL.revokeObjectURL = originalRevokeObjectUrl
})

function setWindow(value: object): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
  })
}

function jsonResponse(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function responseFromChunks(chunks: Uint8Array[]): Response {
  return jsonResponse(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
  )
}

function installBlobDownloadMocks() {
  const calls: string[] = []
  const scheduledCallbacks: Array<() => void> = []
  let downloadedBlob: Blob | undefined
  const anchor = {
    href: '',
    download: '',
    hidden: false,
    click: () => calls.push('click'),
    remove: () => calls.push('remove'),
  }

  setWindow({
    setTimeout: (callback: () => void, delay: number) => {
      calls.push(`schedule-revoke:${delay}`)
      scheduledCallbacks.push(callback)
      return 1
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        assert.equal(tag, 'a')
        return anchor
      },
      body: { append: () => calls.push('append') },
    },
  })
  URL.createObjectURL = (blob: Blob) => {
    downloadedBlob = blob
    return 'blob:personal-data'
  }
  URL.revokeObjectURL = (url: string) => calls.push(`revoke:${url}`)

  return {
    anchor,
    calls,
    getDownloadedBlob: () => downloadedBlob,
    runScheduledCallbacks: () => {
      for (const callback of scheduledCallbacks) callback()
    },
  }
}

describe('personal data JSON download', () => {
  it('uses a stable filename that contains no account identifier', () => {
    assert.equal(
      personalDataExportFilename(new Date('2026-11-12T15:00:00.000Z')),
      'barbearia-dados-pessoais-2026-11-12.json',
    )
  })

  it('opens the file picker in the initiating call before requesting the export', async () => {
    const calls: string[] = []
    let downloadedText = ''
    setWindow({
      showSaveFilePicker: (options: {
        suggestedName: string
        types: Array<{
          description: string
          accept: Record<string, string[]>
        }>
      }) => {
        calls.push('picker')
        assert.equal(
          options.suggestedName,
          'barbearia-dados-pessoais-2026-11-12.json',
        )
        assert.equal(options.types[0]?.accept['application/json']?.[0], '.json')
        return Promise.resolve({
          createWritable: async () =>
            new WritableStream<Uint8Array>({
              write(chunk) {
                downloadedText += new TextDecoder().decode(chunk)
                calls.push('write')
              },
              close() {
                calls.push('close')
              },
            }),
        })
      },
    })
    const response = responseFromChunks([
      new TextEncoder().encode('{"conta":'),
      new TextEncoder().encode('{"nome":"Titular"}}'),
    ])
    response.json = async () => {
      throw new Error('The streaming response must not be parsed as JSON')
    }

    const operation = downloadJsonStream(
      async () => {
        calls.push('request')
        return response
      },
      'barbearia-dados-pessoais-2026-11-12.json',
      new AbortController().signal,
      (phase) => calls.push(phase),
    )

    assert.deepEqual(calls, ['choosing', 'picker'])
    assert.equal(await operation, 'saved')
    assert.equal(downloadedText, '{"conta":{"nome":"Titular"}}')
    assert.ok(calls.indexOf('picker') < calls.indexOf('request'))
    assert.ok(calls.indexOf('write') < calls.indexOf('close'))
  })

  it('waits for each write before sending the next chunk and closes after EOF', async () => {
    const chunks: string[] = []
    const events: string[] = []
    let releaseFirstWrite: (() => void) | undefined
    let firstWriteStarted: (() => void) | undefined
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    const writeStarted = new Promise<void>((resolve) => {
      firstWriteStarted = resolve
    })

    setWindow({
      showSaveFilePicker: async () => ({
        createWritable: async () =>
          new WritableStream<Uint8Array>({
            async write(chunk) {
              const value = new TextDecoder().decode(chunk)
              chunks.push(value)
              events.push(`write:${value}`)
              if (chunks.length === 1) {
                firstWriteStarted?.()
                await firstWrite
              }
            },
            close() {
              events.push('close')
            },
          }),
      }),
    })
    const response = responseFromChunks([
      new TextEncoder().encode('{"ok":'),
      new TextEncoder().encode('true}'),
    ])

    const operation = downloadJsonStream(
      async () => response,
      'dados.json',
      new AbortController().signal,
    )
    await writeStarted
    assert.deepEqual(chunks, ['{"ok":'])
    releaseFirstWrite?.()
    assert.equal(await operation, 'saved')
    assert.deepEqual(chunks, ['{"ok":', 'true}'])
    assert.equal(events.at(-1), 'close')
  })

  it('aborts the file writer and does not report success when the response stream fails', async () => {
    let writerAborted = false
    let writerClosed = false
    setWindow({
      showSaveFilePicker: async () => ({
        createWritable: async () =>
          new WritableStream<Uint8Array>({
            close() {
              writerClosed = true
            },
            abort() {
              writerAborted = true
            },
          }),
      }),
    })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"partial":'))
        controller.error(new Error('Network interrupted'))
      },
    })

    await assert.rejects(
      downloadJsonStream(
        async () => jsonResponse(body),
        'dados.json',
        new AbortController().signal,
      ),
    )
    assert.equal(writerAborted, true)
    assert.equal(writerClosed, false)
  })

  it('aborts a pending file download when its signal is cancelled', async () => {
    const controller = new AbortController()
    let writerAborted = false
    setWindow({
      showSaveFilePicker: async () => ({
        createWritable: async () =>
          new WritableStream<Uint8Array>({
            write() {
              controller.abort()
            },
            abort() {
              writerAborted = true
            },
          }),
      }),
    })
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{}'))
      },
    })

    await assert.rejects(
      downloadJsonStream(
        async () => jsonResponse(body),
        'dados.json',
        controller.signal,
      ),
      (error: unknown) =>
        error instanceof Error && error.name === 'AbortError',
    )
    assert.equal(writerAborted, true)
  })

  it('downloads a small fallback file only after EOF and revokes its object URL', async () => {
    const {
      anchor,
      calls,
      getDownloadedBlob,
      runScheduledCallbacks,
    } = installBlobDownloadMocks()
    const response = responseFromChunks([
      new TextEncoder().encode('{"conta":{"nome":"Titular"}}'),
    ])
    response.headers.set('content-length', 'not-a-valid-length')

    assert.equal(
      await downloadJsonStream(
        async () => response,
        personalDataExportFilename(),
        new AbortController().signal,
      ),
      'started',
    )

    assert.equal(anchor.download, personalDataExportFilename())
    assert.equal(getDownloadedBlob()?.type, 'application/json')
    assert.equal(
      await getDownloadedBlob()?.text(),
      '{"conta":{"nome":"Titular"}}',
    )
    assert.deepEqual(calls, [
      'append',
      'click',
      'remove',
      'schedule-revoke:1000',
    ])
    runScheduledCallbacks()
    assert.equal(calls.at(-1), 'revoke:blob:personal-data')
  })

  it('accepts a fallback file exactly at the 10 MiB limit', async () => {
    installBlobDownloadMocks()
    const content = new Uint8Array(PERSONAL_DATA_BLOB_FALLBACK_LIMIT_BYTES)
    content.fill(0x20)
    content[content.byteLength - 2] = 0x7b
    content[content.byteLength - 1] = 0x7d
    const response = responseFromChunks([
      content,
    ])

    await assert.doesNotReject(
      downloadJsonStream(
        async () => response,
        'dados.json',
        new AbortController().signal,
      ),
    )
  })

  it('rejects a known oversized fallback before creating a Blob', async () => {
    const { calls } = installBlobDownloadMocks()
    const response = responseFromChunks([new Uint8Array([1])])
    response.headers.set(
      'content-length',
      String(PERSONAL_DATA_BLOB_FALLBACK_LIMIT_BYTES + 1),
    )

    await assert.rejects(
      downloadJsonStream(
        async () => response,
        'dados.json',
        new AbortController().signal,
      ),
      PersonalDataExportTooLargeError,
    )
    assert.deepEqual(calls, [])
  })

  it('stops an unknown-size fallback as soon as received bytes exceed the limit', async () => {
    const { calls } = installBlobDownloadMocks()
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const content = new Uint8Array(
          PERSONAL_DATA_BLOB_FALLBACK_LIMIT_BYTES + 1,
        )
        content.fill(0x20)
        content[content.byteLength - 2] = 0x7b
        content[content.byteLength - 1] = 0x7d
        controller.enqueue(content)
      },
      cancel() {
        cancelled = true
      },
    })

    await assert.rejects(
      downloadJsonStream(
        async () => {
          const response = jsonResponse(body)
          response.headers.set('content-length', '1')
          return response
        },
        'dados.json',
        new AbortController().signal,
      ),
      PersonalDataExportTooLargeError,
    )
    assert.equal(cancelled, true)
    assert.deepEqual(calls, [])
  })

  it('does not create a Blob when fallback reading fails or is cancelled', async () => {
    const { calls } = installBlobDownloadMocks()
    const failingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"partial":'))
        controller.error(new Error('Network interrupted'))
      },
    })

    await assert.rejects(
      downloadJsonStream(
        async () => jsonResponse(failingBody),
        'dados.json',
        new AbortController().signal,
      ),
    )

    const controller = new AbortController()
    const pendingBody = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{}'))
      },
    })
    const operation = downloadJsonStream(
      async () => jsonResponse(pendingBody),
      'dados.json',
      controller.signal,
    )
    controller.abort()

    await assert.rejects(
      operation,
      (error: unknown) =>
        error instanceof Error && error.name === 'AbortError',
    )
    assert.deepEqual(calls, [])
  })

  it('rejects invalid or incomplete JSON before closing the file or creating a Blob', async () => {
    let writerAborted = false
    let writerClosed = false
    setWindow({
      showSaveFilePicker: async () => ({
        createWritable: async () =>
          new WritableStream<Uint8Array>({
            close() {
              writerClosed = true
            },
            abort() {
              writerAborted = true
            },
          }),
      }),
    })
    const invalidResponse = responseFromChunks([
      new TextEncoder().encode('{"conta":'),
    ])

    await assert.rejects(
      downloadJsonStream(
        async () => invalidResponse,
        'dados.json',
        new AbortController().signal,
      ),
      JsonStreamValidationError,
    )
    assert.equal(writerAborted, true)
    assert.equal(writerClosed, false)

    const { calls } = installBlobDownloadMocks()
    await assert.rejects(
      downloadJsonStream(
        async () =>
          responseFromChunks([new TextEncoder().encode('{"conta":}')]),
        'dados.json',
        new AbortController().signal,
      ),
      JsonStreamValidationError,
    )
    assert.deepEqual(calls, [])
  })

  it('does not start a request or fallback when the user cancels the file picker', async () => {
    const { calls } = installBlobDownloadMocks()
    setWindow({
      showSaveFilePicker: () =>
        Promise.reject(new DOMException('User cancelled', 'AbortError')),
    })
    let requests = 0

    await assert.rejects(
      downloadJsonStream(
        async () => {
          requests++
          return responseFromChunks([new TextEncoder().encode('{}')])
        },
        'dados.json',
        new AbortController().signal,
      ),
      (error: unknown) =>
        error instanceof Error && error.name === 'AbortError',
    )
    assert.equal(requests, 0)
    assert.deepEqual(calls, [])
  })

  it('uses the bounded Blob fallback when the picker is blocked', async () => {
    const { calls, getDownloadedBlob } = installBlobDownloadMocks()
    const scheduledCallbacks: Array<() => void> = []
    setWindow({
      showSaveFilePicker: () =>
        Promise.reject(new DOMException('Picker blocked', 'SecurityError')),
      setTimeout: (callback: () => void, delay: number) => {
        calls.push(`schedule-revoke:${delay}`)
        scheduledCallbacks.push(callback)
        return 1
      },
    })

    assert.equal(
      await downloadJsonStream(
        async () =>
          responseFromChunks([new TextEncoder().encode('{"ok":true}')]),
        'dados.json',
        new AbortController().signal,
      ),
      'started',
    )
    assert.equal(await getDownloadedBlob()?.text(), '{"ok":true}')
    assert.ok(calls.includes('click'))
    assert.ok(!calls.some((call) => call.startsWith('revoke:')))
    for (const callback of scheduledCallbacks) callback()
    assert.equal(calls.at(-1), 'revoke:blob:personal-data')
  })

  it('does not use Blob fallback after a real file-stream failure', async () => {
    const { calls } = installBlobDownloadMocks()
    setWindow({
      showSaveFilePicker: async () => ({
        createWritable: async () =>
          new WritableStream<Uint8Array>({
            write() {
              throw new Error('Disk write failed')
            },
          }),
      }),
    })

    await assert.rejects(
      downloadJsonStream(
        async () =>
          responseFromChunks([new TextEncoder().encode('{"ok":true}')]),
        'dados.json',
        new AbortController().signal,
      ),
    )
    assert.deepEqual(calls, [])
  })

  it('does not start an authenticated request if the signal is aborted while the picker is open', async () => {
    const controller = new AbortController()
    let resolvePicker:
      | ((handle: {
          createWritable: () => Promise<WritableStream<Uint8Array>>
        }) => void)
      | undefined
    const pickerPromise = new Promise<{
      createWritable: () => Promise<WritableStream<Uint8Array>>
    }>((resolve) => {
      resolvePicker = resolve
    })
    setWindow({ showSaveFilePicker: () => pickerPromise })
    let requests = 0

    const operation = downloadJsonStream(
      async () => {
        requests++
        return responseFromChunks([new TextEncoder().encode('{}')])
      },
      'dados.json',
      controller.signal,
    )

    controller.abort()
    resolvePicker?.({
      createWritable: async () => new WritableStream<Uint8Array>(),
    })

    await assert.rejects(
      operation,
      (error: unknown) =>
        error instanceof Error && error.name === 'AbortError',
    )
    assert.equal(requests, 0)
  })

  it('does not create a Blob when a blocked picker falls back to an oversized response', async () => {
    const { calls } = installBlobDownloadMocks()
    setWindow({
      showSaveFilePicker: () =>
        Promise.reject(new DOMException('Picker blocked', 'NotAllowedError')),
    })
    const response = responseFromChunks([new TextEncoder().encode('{}')])
    response.headers.set(
      'content-length',
      String(PERSONAL_DATA_BLOB_FALLBACK_LIMIT_BYTES + 1),
    )

    await assert.rejects(
      downloadJsonStream(
        async () => response,
        'dados.json',
        new AbortController().signal,
      ),
      PersonalDataExportTooLargeError,
    )
    assert.deepEqual(calls, [])
  })
})
