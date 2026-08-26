/** Browser attachment plugin: fills conversation's composer and message-image slots. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls this package's LocaleNamespaceMap merge (the `attachment` seat).
import type {} from './locales.ts'
import { en, zh } from './locales.ts'
import { ComposerAttachments } from './ComposerAttachments.tsx'
import { MessageImages } from './MessageImages.tsx'

/** Slot registry and services required by this presentation plugin. */
export const inject = ['slots', 'locale']

/**
 * Register attachment presentation without exporting React components as
 * package values. The entry's copy rides two namespaces: the conversation
 * keys it always consumed, plus this plugin's own `attachment` dictionary for
 * the text-file draft surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('attachment', { zh, en }), 'ui-attachment: dictionaries')

  ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
    name: 'conversation.message.images',
    locale: 'conversation',
  }, MessageImages))
  ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments',
    locale: 'conversation',
    inject: () => ({ tAttachment: ctx.locale.bind('attachment') }),
  }, ComposerAttachments))
}
