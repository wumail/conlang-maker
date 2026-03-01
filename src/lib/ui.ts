/**
 * 共享 UI class 常量
 * 基于 DaisyUI v5 + TailwindCSS
 * 所有表单元素通过此文件统一尺寸，避免各组件独立维护
 *
 * 注意：不包含 w-full 等布局类，由使用方自行组合
 */

/** 标准单行文本输入框 */
export const INPUT = "input input-md" as const;

/** 等宽字体输入框（代码/音素/正则等）*/
export const INPUT_MONO = "input input-md font-mono" as const;

/** 下拉选择框 */
export const SELECT = "select select-md" as const;

/** 多行文本域 */
export const TEXTAREA = "textarea textarea-md" as const;

/** 主操作按钮（蓝色）*/
export const BTN_PRIMARY = "btn btn-sm btn-primary btn-soft gap-1" as const;

export const BTN_PRIMARY_MD = "btn btn-outline btn-primary btn-soft gap-1" as const;

/** 成功操作按钮（绿色）*/
export const BTN_SUCCESS = "btn btn-sm btn-success btn-soft gap-1" as const;

/** 次要幽灵按钮 */
export const BTN_GHOST = "btn btn-sm btn-ghost gap-1" as const;

/** 幽灵方形小按钮（图标按钮）*/
export const BTN_GHOST_SQ = "btn btn-ghost btn-xs btn-square" as const;

/** 轮廓危险按钮 */
export const BTN_OUTLINE_ERROR = "btn btn-sm btn-outline btn-error" as const;

/** 删除/危险图标按钮 */
export const BTN_ERROR = "btn btn-ghost btn-sm btn-square text-base-content/50 hover:text-error" as const;

/** 文字链接按钮 */
export const BTN_LINK = "btn btn-soft btn-primary btn-sm gap-1" as const;

/** 卡片容器 */
export const CARD = "card bg-base-100 shadow-sm border border-base-200" as const;

/** 卡片正文 */
export const CARD_BODY = "card-body" as const;

/** DaisyUI 复选框 */
export const CHECKBOX = "checkbox checkbox-sm" as const;

/** DaisyUI 开关 */
export const TOGGLE = "toggle toggle-sm" as const;

/** DaisyUI 徽章 */
export const BADGE = "badge badge-sm" as const;

/** 小节标题 (h3) */
export const SECTION_HEADER = "text-sm font-semibold text-base-content/70 mb-2" as const;

/** 表单字段标签 */
export const FIELD_LABEL = "text-sm font-medium text-base-content/80" as const;
