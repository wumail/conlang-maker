/** 项目级常量 — 避免在多处硬编码相同字面量 */

/** 默认语言 ID（原始语言） */
export const DEFAULT_LANGUAGE_ID = 'lang_proto' as const;

/** 默认词源类型 */
export const DEFAULT_ORIGIN_TYPE = 'a_priori' as const;

/** 默认语言目录路径 */
export const DEFAULT_LANGUAGE_PATH = 'proto_language' as const;

/** 工作区配置文件扩展名 */
export const CONLANG_FILE_EXTENSION = '.conlang' as const;

/** 默认工作区版本 */
export const WORKSPACE_VERSION = '3.0' as const;

/** GitHub 仓库信息（用于版本检查） */
export const GITHUB_REPO_OWNER = 'wumail' as const;
export const GITHUB_REPO_NAME = 'conlang-maker' as const;
