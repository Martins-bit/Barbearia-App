import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  downloadJsonFile,
  personalDataExportFilename,
} from './downloadJson.ts'

const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'document',
)
const originalCreateObjectUrl = URL.createObjectURL
const originalRevokeObjectUrl = URL.revokeObjectURL

afterEach(() => {
  if (originalDocumentDescriptor) {
    Object.defineProperty(globalThis, 'document', originalDocumentDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }
  URL.createObjectURL = originalCreateObjectUrl
  URL.revokeObjectURL = originalRevokeObjectUrl
})

describe('personal data JSON download', () => {
  it('uses a stable filename that contains no account identifier', () => {
    assert.equal(
      personalDataExportFilename(new Date('2026-11-12T15:00:00.000Z')),
      'barbearia-dados-pessoais-2026-11-12.json',
    )
  })

  it('downloads the JSON as an attachment and releases the temporary URL', async () => {
    const calls: string[] = []
    let downloadedBlob: Blob | undefined
    const anchor = {
      href: '',
      download: '',
      hidden: false,
      click: () => calls.push('click'),
      remove: () => calls.push('remove'),
    }

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

    const exportData = { conta: { nome: 'Titular' } }
    downloadJsonFile(exportData, personalDataExportFilename())

    assert.equal(anchor.href, 'blob:personal-data')
    assert.equal(anchor.download, personalDataExportFilename())
    assert.equal(anchor.hidden, true)
    assert.deepEqual(calls, [
      'append',
      'click',
      'remove',
      'revoke:blob:personal-data',
    ])
    assert.equal(downloadedBlob?.type, 'application/json;charset=utf-8')
    assert.equal(await downloadedBlob?.text(), JSON.stringify(exportData, null, 2))
  })
})
