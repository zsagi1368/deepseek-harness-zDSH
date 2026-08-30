/**
 * 探测失败的原因分类。
 * - 'module-not-found': 模块说明符无法解析（未安装/未导出）。
 * - 'symbol-missing': 模块可导入，但不导出指定符号。
 * - 'shape-mismatch': 符号存在，但未通过 shape 校验。
 * - 'import-threw': 动态 import 本身抛错（模块求值异常等）。
 */
export type ProbeReason = 'module-not-found' | 'symbol-missing' | 'shape-mismatch' | 'import-threw';
/**
 * probeSymbol 的探测结果。
 */
export interface ProbeResult<T = unknown> {
    /** 模块可导入、符号存在且通过 shape 校验。 */
    present: boolean;
    /** 符号值（present 时）。 */
    value: T | undefined;
    /** 失败原因（present=false 时）。 */
    reason: ProbeReason | undefined;
    /** 原始错误，供日志。 */
    error?: unknown;
}
/**
 * 动态探测一个模块是否可导入且导出指定符号，形状不匹配也算缺失。
 * 失败永不 throw；用于版本感知：优先探测新版符号，缺失时回退旧版。
 * @param specifier - 要动态 import 的模块说明符（如 '@deepseek-ai/dsh-api-remotes/client'）。
 * @param symbol - 要探测的具名导出（如 'LlmConfigurableProvider'）。
 * @param shape - 可选的形状校验器；对导出的值做 typeof / 字段检查，返回 true 才认为存在。
 * @returns 探测结果（value 可能为 undefined）。
 */
export declare function probeSymbol<T = unknown>(specifier: string, symbol: string, shape?: (value: unknown) => boolean): Promise<ProbeResult<T>>;
/**
 * 同步读取已加载模块的导出形状（非动态 import），用于静态别名场景。
 * @param namespace - 已静态 import 的模块命名空间对象。
 * @param symbol - 要检查的导出名。
 * @returns 符号值或 undefined。
 */
export declare function memberOf<T = unknown>(namespace: object, symbol: string): T | undefined;
/**
 * 读取一个已安装包的版本号（host 侧）；失败返回 undefined 而不是抛错。
 * 用于区分「官方 0.1.2-alpha.1 / zDSH 0.1.1-rc.2」等版本档位。
 * @param packageName - 包名（如 '@deepseek-ai/dsh-llm'）。
 * @returns 包的 version 字段；读取失败返回 undefined。
 */
export declare function versionOf(packageName: string): Promise<string | undefined>;
//# sourceMappingURL=probe.d.ts.map