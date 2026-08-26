// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type {
  ComposerAttachment, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls this package's LocaleNamespaceMap merge (the `attachment` seat).
import type {} from '../src/client/locales.ts'
import { ComposerAttachments } from '../src/client/ComposerAttachments.tsx'
import type { WiredComposerAttachmentsProps } from '../src/client/ComposerAttachments.tsx'
import { DRAFT_TEXT_MAX_BYTES } from '../src/client/text-attachments.ts'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = ((key: string, params?: Readonly<Record<string, unknown>>): string => {
  const messages: Record<string, string> = {
    'image.pending': '待发送图片',
    'image.original': '原图',
    'image.preview': '原图预览',
    'image.closePreview': '关闭原图预览',
    'image.openOriginal': '查看原图',
    'image.scrollLeft': '向左滚动图片',
    'image.scrollRight': '向右滚动图片',
    'image.dropBlocked': '当前无法添加图片',
    'image.dropTitle': '图片拖动到此处即可添加',
  }
  if (key === 'image.remove') {
    const name = params?.name
    return `移除图片 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'image.dropDesc') {
    const count = params?.count
    const size = params?.size
    return `最多 ${typeof count === 'number' ? String(count) : ''} 张，每张 ${typeof size === 'string' ? size : ''}`
  }
  return messages[key] ?? key
}) as ComposerAttachmentsProps['t']

function attachment(id: string, name = `${id}.png`): ComposerAttachment {
  return {
    kind: 'image',
    id: id as ComposerAttachment['id'],
    file: new File([Uint8Array.of(1)], name, { type: 'image/png' }),
    previewUrl: `blob:${id}`,
  }
}

function props(overrides: Partial<WiredComposerAttachmentsProps> = {}): WiredComposerAttachmentsProps {
  const kit = draftKit()
  // The cast absorbs Partial-spread `undefined` under exactOptionalPropertyTypes.
  return {
    attachments: [],
    canAcceptDrop: true,
    onAddImages: () => {},
    onRemoveImage: () => {},
    t,
    useInput: kit.useInput,
    inputActions: kit.inputActions,
    ...overrides,
  } as WiredComposerAttachmentsProps
}

/**
 * Fake the session-maybe standard kit: the machine's draft round-trips
 * through `setDraft`, so async intake reads see the post-append state just
 * like the real snapshot hook does.
 */
function draftKit(initial = ''): {
  useInput: ComposerAttachmentsProps['useInput']
  inputActions: ComposerAttachmentsProps['inputActions']
  setDraft: Mock<(text: string) => void>
  box: { current: string }
} {
  const box = { current: initial }
  const setDraft = vi.fn((text: string) => { box.current = text })
  return {
    useInput: ((selector: (state: unknown) => unknown) =>
      selector({ draft: box.current, phase: 'plain' })) as ComposerAttachmentsProps['useInput'],
    inputActions: {
      setDraft,
      addImages: () => true,
      removeImage: () => {},
      pruneImages: () => {},
      submit: () => {},
    },
    setDraft,
    box,
  }
}

/** This plugin's own namespace translator, resolved like the inject face does. */
const tAttachment = ((key: string, params?: Readonly<Record<string, unknown>>): string => {
  if (key === 'text.remove') return `移除文本 ${String(params?.name)}`
  const messages: Record<string, string> = {
    'text.dropTitle': '文件拖动到此处即可添加',
    'text.dropBlocked': '当前无法添加文件',
    'text.pending': '待发送文本',
  }
  return messages[key] ?? key
}) as TranslateNS<'attachment'>

function textFile(name: string, content: string, type = ''): File {
  return new File([content], name, { type })
}

describe('ComposerAttachments', () => {
  it('accepts file drops anywhere on the document and keeps non-file drags native', () => {
    const onAddImages = vi.fn()
    const view = render(<ComposerAttachments {...props({
      onAddImages,
      dropLimits: { count: 20, size: '5MB' },
    })} />)

    expect(fireEvent.dragEnter(document.body, { dataTransfer: null })).toBe(true)
    const textTransfer = { types: ['text/plain'], files: [], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.dragOver(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.drop(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(view.queryByRole('status')).toBeNull()

    const image = attachment('dropped').file
    const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer })).toBe(false)
    expect(view.getByRole('status').textContent).toContain('图片拖动到此处即可添加')
    expect(view.getByRole('status').textContent).toContain('最多 20 张，每张 5MB')
    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(false)
    expect(onAddImages).toHaveBeenCalledWith([image])
    expect(view.queryByRole('status')).toBeNull()
  })

  it('tracks nested file drags and clears an aborted drag', () => {
    const view = render(<ComposerAttachments {...props()} />)
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    fireEvent.dragLeave(document.body, {
      dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'none' },
    })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.getByRole('status')).toBeTruthy()
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.documentElement, { dataTransfer })
    const leftViewport = new Event('dragleave', { bubbles: true, cancelable: true })
    Object.defineProperties(leftViewport, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: -1 },
      clientY: { value: 5 },
    })
    fireEvent(document.documentElement, leftViewport)
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnd(window, { dataTransfer })
    expect(view.queryByRole('status')).toBeNull()
  })

  it('shows a blocked drop without forwarding its files', () => {
    const onAddImages = vi.fn()
    const view = render(<ComposerAttachments {...props({ canAcceptDrop: false, onAddImages })} />)
    const image = attachment('blocked').file
    const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'copy' }
    fireEvent.dragEnter(document.body, { dataTransfer })
    expect(view.getByRole('status').textContent).toBe('当前无法添加图片')
    fireEvent.dragOver(document.body, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('none')
    fireEvent.drop(document.body, { dataTransfer })
    expect(onAddImages).not.toHaveBeenCalled()
    expect(view.queryByRole('status')).toBeNull()
  })

  it('routes rail removal and closes previews on Escape or attachment removal', () => {
    const onRemoveImage = vi.fn()
    const image = attachment('draft-1', 'pixel.png')
    const initial = props({ attachments: [image], onRemoveImage })
    const view = render(<ComposerAttachments {...initial} />)

    fireEvent.click(view.getByRole('button', { name: '移除图片 pixel.png' }))
    expect(onRemoveImage).toHaveBeenCalledWith(image.id)
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    view.rerender(<ComposerAttachments {...props({ attachments: [], onRemoveImage })} />)
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()

    view.rerender(<ComposerAttachments {...initial} />)
    fireEvent.click(view.getByTitle('查看原图'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()
  })

  it('labels an unnamed attachment and its original-image preview', () => {
    const image = attachment('unnamed', '')
    const view = render(<ComposerAttachments {...props({ attachments: [image] })} />)
    expect(view.getByAltText('待发送图片')).toBeTruthy()
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByAltText('原图')).toBeTruthy()
  })

  it('appends a dropped text file as a name-headed draft segment with a removable card', async () => {
    const kit = draftKit('existing question')
    const view = render(<ComposerAttachments {...props({ ...kit, tAttachment })} />)
    const dataTransfer = {
      types: ['Files'],
      files: [textFile('notes.txt', 'line1\nline2')],
      dropEffect: 'none',
    }
    await act(async () => { fireEvent.drop(document.body, { dataTransfer }) })
    const segment = '[notes.txt]\nline1\nline2\n'
    expect(kit.setDraft).toHaveBeenCalledWith(`existing question\n\n${segment}`)
    expect(kit.box.current).toBe(`existing question\n\n${segment}`)
    // The card speaks the plugin namespace's remove copy and drops its span
    // from the machine draft on removal.
    fireEvent.click(view.getByRole('button', { name: '移除文本 notes.txt' }))
    expect(kit.setDraft).toHaveBeenLastCalledWith('existing question')
    expect(kit.box.current).toBe('existing question')
    expect(view.queryByRole('button', { name: '移除文本 notes.txt' })).toBeNull()
  })

  it('stacks back-to-back text drops instead of overwriting them', async () => {
    const kit = draftKit('')
    render(<ComposerAttachments {...props({ ...kit })} />)
    await act(async () => {
      fireEvent.drop(document.body, {
        dataTransfer: { types: ['Files'], files: [textFile('a.md', 'first')], dropEffect: 'none' },
      })
    })
    await act(async () => {
      fireEvent.drop(document.body, {
        dataTransfer: { types: ['Files'], files: [textFile('b.md', 'second')], dropEffect: 'none' },
      })
    })
    expect(kit.box.current).toBe('[a.md]\nfirst\n\n[b.md]\nsecond\n')
  })

  it('keeps binary or oversized text candidates out of the draft', async () => {
    const kit = draftKit('')
    const view = render(<ComposerAttachments {...props({ ...kit, tAttachment })} />)
    const binary = new File([Uint8Array.of(0x61, 0x00, 0x62)], 'utf16.txt', { type: '' })
    const oversized = { name: 'huge.log', size: DRAFT_TEXT_MAX_BYTES + 1, type: '', arrayBuffer: vi.fn() }
    await act(async () => {
      fireEvent.drop(document.body, {
        dataTransfer: { types: ['Files'], files: [binary, oversized as unknown as File], dropEffect: 'none' },
      })
    })
    expect(kit.setDraft).not.toHaveBeenCalled()
    expect(view.queryByText('huge.log')).toBeNull()
    expect(view.queryByTitle('utf16.txt')).toBeNull()
  })

  it('splits a mixed batch: images ride onAddImages, text rides the draft', async () => {
    const onAddImages = vi.fn()
    const kit = draftKit('')
    render(<ComposerAttachments {...props({ onAddImages, ...kit, tAttachment })} />)
    const image = attachment('mixed').file
    await act(async () => {
      fireEvent.drop(document.body, {
        dataTransfer: { types: ['Files'], files: [image, textFile('readme.md', 'hello')], dropEffect: 'none' },
      })
    })
    expect(onAddImages).toHaveBeenCalledWith([image])
    expect(kit.box.current).toBe('[readme.md]\nhello\n')
  })

  it('invites file drops through the attachment namespace when composed', () => {
    const view = render(<ComposerAttachments {...props({ tAttachment, dropLimits: { count: 20, size: '5MB' } })} />)
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    fireEvent.dragEnter(document.body, { dataTransfer })
    expect(view.getByRole('status').textContent).toContain('文件拖动到此处即可添加')
    expect(view.getByRole('status').textContent).toContain('最多 20 张，每张 5MB')
  })

  it('reaps a lost drag when no dragleave ever arrives', () => {
    const view = render(<ComposerAttachments {...props()} />)
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    fireEvent.dragEnter(document.body, { dataTransfer })
    expect(view.getByRole('status')).toBeTruthy()
    // OS-initiated drags have no in-page source (no dragend) and can end
    // outside the page without a paired dragleave; the first ordinary pointer
    // event proves the drag is gone.
    fireEvent.pointerMove(window)
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.body, { dataTransfer })
    expect(view.getByRole('status')).toBeTruthy()
    fireEvent.blur(window)
    expect(view.queryByRole('status')).toBeNull()
  })
})
