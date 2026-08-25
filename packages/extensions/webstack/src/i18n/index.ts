/**
 * i18n 入口：语言协商与键查找（W-B-79 双语全覆盖）。所有用户可见文案均
 * 必须有 zh/en 双语键；覆盖率由测试断言。
 *
 * 统一查找表 text(key, locale) 合并八册文案（错误处置 / 引擎状态 /
 * 缓存凭据联网模式 / 抓取安全 / 诊断 / 垂直频道 / keyed 引擎 / MCP 与基础
 * 设施 / P1 内核增强）；errorText 保持向后兼容并委托本表。
 * @module webstack/i18n
 */

import type { EngineErrorCode } from '../kernel/types.js'
import {
  type CacheCredsI18nKey,
  cacheCredsMessagesEn,
  cacheCredsMessagesZh,
} from './cache-creds.js'
import { type DoctorI18nKey, doctorMessagesEn, doctorMessagesZh } from './doctor.js'
import { errorMessagesEn } from './en.js'
import { type EngineStatusKey, engineMessagesEn, engineMessagesZh } from './engines.js'
import {
  type FetchSafetyBlockedKey,
  type FetchSafetyKey,
  fetchMessagesEn,
  fetchMessagesZh,
  fetchSafetyBlockedEn,
  fetchSafetyBlockedZh,
} from './fetch-safety.js'
import { type KernelP1I18nKey, kernelP1MessagesEn, kernelP1MessagesZh } from './kernel-p1.js'
import {
  type KeyedEngineStatusKey,
  keyedEngineMessagesEn,
  keyedEngineMessagesZh,
} from './keyed-engines.js'
import { type McpInfraI18nKey, mcpInfraMessagesEn, mcpInfraMessagesZh } from './mcp-infra.js'
import { type VerticalsI18nKey, verticalsMessagesEn, verticalsMessagesZh } from './verticals.js'
import { type ErrorI18nKey, errorMessagesZh } from './zh.js'

export type {
  CacheCredsI18nKey,
  DoctorI18nKey,
  EngineStatusKey,
  ErrorI18nKey,
  FetchSafetyBlockedKey,
  FetchSafetyKey,
  KernelP1I18nKey,
  KeyedEngineStatusKey,
  McpInfraI18nKey,
  VerticalsI18nKey,
}
/** 渲染语言闭包（zh/en 双语全覆盖）。 */
export type Locale = 'zh' | 'en'

/** 全部分册键的联合（新增分册 = 并入 union + 两张查找表）。 */
export type WebstackI18nKey =
  | ErrorI18nKey
  | EngineStatusKey
  | CacheCredsI18nKey
  | FetchSafetyKey
  | FetchSafetyBlockedKey
  | DoctorI18nKey
  | VerticalsI18nKey
  | KeyedEngineStatusKey
  | McpInfraI18nKey
  | KernelP1I18nKey

/** 中文统一查找表（Partial：运行期分册缺键时由 `?? key` 兜底，绝不伪造文案）。 */
const TABLE_ZH: Readonly<Partial<Record<WebstackI18nKey, string>>> = Object.freeze({
  ...errorMessagesZh,
  ...engineMessagesZh,
  ...cacheCredsMessagesZh,
  ...fetchMessagesZh,
  ...fetchSafetyBlockedZh,
  ...doctorMessagesZh,
  ...verticalsMessagesZh,
  ...keyedEngineMessagesZh,
  ...mcpInfraMessagesZh,
  ...kernelP1MessagesZh,
})

/** English unified lookup table (partial at runtime: the frozen spread may miss a key). */
const TABLE_EN: Readonly<Partial<Record<WebstackI18nKey, string>>> = Object.freeze({
  ...errorMessagesEn,
  ...engineMessagesEn,
  ...cacheCredsMessagesEn,
  ...fetchMessagesEn,
  ...fetchSafetyBlockedEn,
  ...doctorMessagesEn,
  ...verticalsMessagesEn,
  ...keyedEngineMessagesEn,
  ...mcpInfraMessagesEn,
  ...kernelP1MessagesEn,
})

/**
 * 统一文案查找：任意分册键 → 双语文案。未知 locale 安全回落中文；
 * 未知 key 返回键本身（调用方可辨识，绝不伪造文案）。
 * @param key - 任意分册的 i18n 键。
 * @param locale - 语言（默认 zh）。
 * @returns 文案文本。
 */
export function text(key: WebstackI18nKey, locale: Locale = 'zh'): string {
  return locale === 'en' ? (TABLE_EN[key] ?? key) : (TABLE_ZH[key] ?? key)
}

/**
 * 取统一错误码的处置文本（兼容入口，委托 text）。
 * @param code - 闭集错误码。
 * @param locale - 语言（默认 zh）。
 * @returns 错误处置文案。
 */
export function errorText(code: EngineErrorCode, locale: Locale = 'zh'): string {
  return text(`webstack.error.${code}`, locale)
}
