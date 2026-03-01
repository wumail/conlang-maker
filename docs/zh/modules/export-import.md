# 导出与导入

**导航**：点击左侧 `导出`

## 导出格式

| 格式 | 内容 | 适用场景 |
|------|------|----------|
| **PDF** | 完整语言参考文档 | 打印精美的语言参考书（封面、正字法、屈折范式、语法手册、词典） |
| **Excel** | 多 Sheet 工作簿 | 用 Excel 管理和分析词典（音素表、罗马音映射、完整词典） |
| **Hunspell (.dic/.aff)** | 拼写检查词典 | 让 LibreOffice 等文字处理软件能拼写检查你的语言（含基础形式 + 所有屈折变位形式） |
| **CSV** | 词典表格 | 备份或转入其他工具（Unicode BOM 头，Excel 中文兼容） |
| **LLM Prompt (.md)** | AI 对话 Prompt | 让 AI 学会你的语言（完整语言描述 Markdown + 5 个建议问题） |

### 操作步骤

1. 选择格式
2. 点击导出按钮
3. 选择保存位置

## LLM Prompt

生成包含完整语言描述的 Markdown 文件，可直接提交给 AI 助手使用：

- 复制到剪贴板
- 下载为 `.md` 文件
- 内含 5 个推荐 Prompt 问题

:::tip
将 LLM Prompt 粘贴到 ChatGPT / Claude 等 AI 对话中，AI 将能用你的语言造句、翻译、甚至创作故事。
:::

## 导入

- **CSV 导入**：自动检测格式（PolyGlot / Vulgarlang / 通用格式）
- 自动列映射（word / ipa / pos / gloss / definition）
- POS 自动标准化
- 预览确认后批量导入
