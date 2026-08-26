// @vitest-environment jsdom
/**
 * The guided installation entry: the steps it teaches, the clipboard contract
 * of its per-command copy controls, and the ecosystem links it hands out.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInstallGuideTab } from '../src/client/PluginInstallGuideTab.tsx'
import type { PluginInstallGuideTabProps } from '../src/client/PluginInstallGuideTab.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window.navigator, 'clipboard')
})

const t = (key: keyof typeof en) => en[key]

function renderGuide() {
  render(<PluginInstallGuideTab {...({ t } as unknown as PluginInstallGuideTabProps)} />)
}

/** The four commands the guide teaches, as their rows render them. */
const COMMANDS = [
  'dsh plugin --profile <profile> add ./hello-plugin',
  'dsh plugin --profile <profile> add git+https://github.com/<owner>/<repo>.git#<commit>',
  'dsh plugin --profile <profile> add @scope/my-dsh-plugin@1.2.3',
  'dsh plugin --profile <profile> add ./hello-plugin-0.1.0.tgz',
] as const

describe('PluginInstallGuideTab', () => {
  it('walks the three steps with one command row per source kind', () => {
    renderGuide()

    expect(screen.getByText(en.installIntro)).toBeTruthy()
    for (const key of ['installSourceHeading', 'installRunHeading', 'installVerifyHeading'] as const) {
      expect(screen.getByRole('heading', { name: en[key] })).toBeTruthy()
    }
    for (const command of COMMANDS) {
      expect(screen.getByText(command)).toBeTruthy()
    }
  })

  it('copies a command verbatim and says so when the host accepted it', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderGuide()

    fireEvent.click(screen.getByRole('button', { name: `${en.installCopy}: ${en.installSourceGit}` }))

    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(en.installCopied) })
    expect(writeText).toHaveBeenCalledWith(COMMANDS[1])
  })

  it('says when a copy was refused instead of claiming success', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('denied')))
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderGuide()

    fireEvent.click(screen.getByRole('button', { name: `${en.installCopy}: ${en.installSourceNpm}` }))

    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(en.installCopyFailed) })
  })

  it('keeps feedback per row rather than moving one shared line around', async () => {
    // The first command lands; every other write is refused by the host.
    const writeText = vi.fn(async (text: string) => {
      if (text !== COMMANDS[0]) throw new Error('denied')
    })
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderGuide()

    fireEvent.click(screen.getByRole('button', { name: `${en.installCopy}: ${en.installSourceCheckout}` }))
    fireEvent.click(screen.getByRole('button', { name: `${en.installCopy}: ${en.installSourceTarball}` }))

    await waitFor(() => { expect(screen.getAllByRole('status')).toHaveLength(2) })
    expect(screen.getAllByRole('status').map(node => node.textContent))
      .toEqual([en.installCopied, en.installCopyFailed])
  })

  it('hands out the Plugin Center, registry catalog, and tutorial links', () => {
    renderGuide()

    const links = screen.getAllByRole('link')
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      'https://github.com/zsagi1368/zdsh-plugin-center/releases',
      'https://github.com/zsagi1368/zdsh-plugin-registry',
      'https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md',
    ])
    // A new tab without handing the opener reference to the target.
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noreferrer')
    }
  })
})
