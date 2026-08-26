/**
 * The guided plugin-installation entry, contributed as one Plugins tab.
 *
 * Installing a plugin is a terminal gesture — `dsh plugin` forwards to pnpm in
 * the profile directory, and the write path (profile manifests, bundle layers)
 * belongs to the CLI and the Host, not to a browser page. What this deployment
 * has no answer for yet is discovery: nothing here fetches a marketplace
 * catalog or stages an install plan. That flow exists as the separately
 * installed Plugin Center extension, so this tab does what a settings page can
 * do honestly: walk the user through the exact commands for each source kind,
 * put them one click from the clipboard, and link the registry catalog, the
 * extension's releases, and the packaging tutorial.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './PluginsSettingsSection.module.css'

/** Props the renderer binds for the guide tab; the copy seat is all it reads. */
export type PluginInstallGuideTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.plugins'>

/**
 * One installable source kind with its ready-to-run command. The examples are
 * the tutorial's own (`docs/user/develop/basic/publish.md`), so a user who
 * copies here and reads there sees the same shapes; `<profile>` and the
 * bracketed placeholders stay literal for the user to replace.
 */
interface InstallCommand {
  /** Stable identity for per-row copy feedback. */
  readonly id: 'checkout' | 'git' | 'npm' | 'tarball'
  /** Locale key naming this source kind. */
  readonly labelKey: PluginsSettingsLocaleKey
  /** The command as it would be pasted into a terminal. */
  readonly command: string
}

const INSTALL_COMMANDS: readonly InstallCommand[] = [
  { id: 'checkout', labelKey: 'installSourceCheckout', command: 'dsh plugin --profile <profile> add ./hello-plugin' },
  {
    id: 'git',
    labelKey: 'installSourceGit',
    command: 'dsh plugin --profile <profile> add git+https://github.com/<owner>/<repo>.git#<commit>',
  },
  { id: 'npm', labelKey: 'installSourceNpm', command: 'dsh plugin --profile <profile> add @scope/my-dsh-plugin@1.2.3' },
  { id: 'tarball', labelKey: 'installSourceTarball', command: 'dsh plugin --profile <profile> add ./hello-plugin-0.1.0.tgz' },
] as const

/**
 * Ecosystem pointers. The Plugin Center is not part of this monorepo's shipped
 * client: it installs through the same command this tab teaches, and its
 * releases page is where the exact commit to pin lives. The registry hosts the
 * reviewed `catalog.json` that extension reads.
 */
const PLUGIN_CENTER_RELEASES_URL = 'https://github.com/zsagi1368/zdsh-plugin-center/releases'
const PLUGIN_REGISTRY_URL = 'https://github.com/zsagi1368/zdsh-plugin-registry'
const PLUGIN_TUTORIAL_URL
  = 'https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md'

/**
 * Render the guided installation steps with per-command clipboard controls.
 * @param props - the section locale seat (runtime shares arrive unused).
 * @returns the installation guide.
 */
export function PluginInstallGuideTab(props: PluginInstallGuideTabProps): ReactNode {
  const { t } = props
  // One entry per command row once copied, `true` when the host accepted the
  // write. The status line persists rather than timing out: a message that
  // vanishes on a timer can be gone before an assistive reader reaches it.
  const [copied, setCopied] = useState<ReadonlyMap<string, boolean>>(new Map())

  const copyCommand = (id: string, command: string): void => {
    void writeClipboard(command).then((accepted) => {
      setCopied(current => new Map(current).set(id, accepted))
    })
  }

  return (
    <div className={css.guide}>
      <p className={css.guideIntro}>{t('installIntro')}</p>
      <ol className={css.guideSteps}>
        <li>
          <h3 className={css.guideStepHeading}>{t('installSourceHeading')}</h3>
          <p className={css.guideStepBody}>{t('installSourceBody')}</p>
        </li>
        <li>
          <h3 className={css.guideStepHeading}>{t('installRunHeading')}</h3>
          <p className={css.guideStepBody}>{t('installRunHint')}</p>
          <div className={css.guideCommands}>
            {INSTALL_COMMANDS.map(({ id, labelKey, command }) => {
              const feedback = copied.get(id)
              return (
                <div className={css.guideCommandRow} key={id} data-source={id}>
                  <span className={css.guideSourceLabel}>{t(labelKey)}</span>
                  <code className={css.guideCommandText}>{command}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`${t('installCopy')}: ${t(labelKey)}`}
                    onClick={() => { copyCommand(id, command) }}
                  >
                    {t('installCopy')}
                  </Button>
                  {feedback !== undefined
                    ? (
                      <span
                        className={feedback ? css.guideCopied : css.guideCopyFailed}
                        role="status"
                      >
                        {feedback ? t('installCopied') : t('installCopyFailed')}
                      </span>
                    )
                    : null}
                </div>
              )
            })}
          </div>
        </li>
        <li>
          <h3 className={css.guideStepHeading}>{t('installVerifyHeading')}</h3>
          <p className={css.guideStepBody}>{t('installVerifyHint')}</p>
        </li>
      </ol>
      <p className={css.guideHubNote}>
        {t('installHubIntro')}
        {' '}
        <a className={css.guideLink} href={PLUGIN_CENTER_RELEASES_URL} target="_blank" rel="noreferrer">
          {t('installCenterLink')}
        </a>
        {' · '}
        <a className={css.guideLink} href={PLUGIN_REGISTRY_URL} target="_blank" rel="noreferrer">
          {t('installRegistryLink')}
        </a>
        {' · '}
        <a className={css.guideLink} href={PLUGIN_TUTORIAL_URL} target="_blank" rel="noreferrer">
          {t('installDocsLink')}
        </a>
      </p>
    </div>
  )
}
