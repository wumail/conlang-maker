# Conlang Maker MCP · 执行日志

按 [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) §6 的模板，在末尾追加记录。

---

### 规划阶段（非任务）
- 执行者：Claude Opus 5.5　日期：2026-11-11　提交：未提交
- 结果：完成
- 内容：
  - 产出 [BRD.md](./BRD.md)、[PRD.md](./PRD.md) v0.2、[EXECUTION_PLAN.md](./EXECUTION_PLAN.md)。
  - 负责人确认 PRD §13 中的全部决策（Q1–Q7）。
  - 已手工备份 Terrax 工作区中含旧版书写字段的 6 个 `phonology.json`（只复制，未修改原文件），SHA-256 前 16 位与原文件逐一核对一致：
    - 备份位置：`/Users/jrdamocles/code/TERRAX/人工语言/Terrax双语系工作区/.conlang-maker/backup/legacy-writing-20261111/`
    - 文件：`stages/lamitic_alpha`（d8c4d7a64ddc1886）、`branches/l_east`（03cb57cdcd1b81bc）、`branches/l_lake`（95cb093c822ee477）、`branches/l_plateau`（03b7081a682da66d）、`branches/l_island`（b5987e1ecb3c53c3）、`branches/i_peninsula`（bf80746037d392b3）
- 偏差与决定：项目锁协议从 PRD v0.1 的 flock / fs2 改为基于 `mkdir` 的目录锁（Bun / Node 没有原生 flock，且这样跨语言更容易保持一致），PRD §3.4 已同步。
- 遗留事项：T0.1 需要负责人决定如何处理当前约 54 项未提交改动。


### 文档审查修订（非实现任务）

- 执行者为 Codex，日期为 2026-11-11，提交状态为未提交。
- 本轮完成 BRD v0.2、PRD v0.3、EXECUTION_PLAN v1.1 的交叉修订。
- GUI 保存版本校验前置到 M2，覆盖延迟、排队和在途保存，新增 T3.11。
- 补充每次尝试独立 owner 的目录锁协议、项目事务与崩溃恢复、一致读取、operation_id 重试语义、项目级快照和语言回收站恢复。回滚记录为新操作并保留其他恢复点。
- 增加 Rust/GUI 未知字段保真、本地/有效继承视图分离及祖先/父链缓存失效任务 T1.13–T1.15。修正 trace 与排版索引、MCP tsconfig 路径和 Bun 类型依赖，真实数据验收改用当次副本事实。
- 本轮验收通过 53 项任务的表/卡依赖及规模一致性、依赖无环、76 个工具的任务覆盖、M2 GUI CAS、四份文档版本及本地链接检查。独立复核补齐了锁内重试判定、目录同步顺序和被移除语言的历史转存。并发、故障注入、GUI 与字体排版运行验证列入相应实现任务。
- 本轮设计选择为项目事务日志、精确 owner 身份回收、回滚保留历史及 M2 双方 CAS。跨平台锁语义、事务替换及 HarfBuzz wrapper 行为通过任务技术验证。
- 后续按执行计划推进实现，并继续处理原规划记录中的基线确认事项。
