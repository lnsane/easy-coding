# 开发计划：为编排功能补齐「文档级角色绑定」链路并修复执行记录链路上的三处缺陷

## 现状盘点

需求的三条验收标准，**在当前代码里已经全部实现**。逐条核对如下：

| 需求条目 | 现状 | 位置 |
| --- | --- | --- |
| 编排中可选择角色 | 已实现 | `RunConfirmDialog.tsx:96-124`（执行前弹窗选角色，网格卡片）、`store.ts:157-160` |
| 角色可配职责 / 职位 / 提示词 | 已实现 | 数据结构 `types.ts:110-132` 的 `Role.duty` / `Role.title` / `Role.prompt`；表单 `RoleManager.tsx:144-153`（职位）、`156-166`（职责）、`168-181`（提示词）；持久化 `db.ts:98-107`（roles 表）、`572-589`（saveRole） |
| Markdown 编辑器上方存在执行编排任务的按钮 | 已实现 | `DocEditor.tsx:603-623`（「⚡ 执行编排任务」，位于顶栏内、MarkdownToolbar 之上）、`DocEditor.tsx:659` |
| 点击按钮可触发编排任务执行 | 已实现 | `DocEditor.tsx:351-446` → preload `index.ts:99-111,182` → main `index.ts:149-168` → `orchestrate.ts:202-369` |

需求里标注的三条「待确认」，在 v0.5.0 已有既定答案（见 `doc/v0.5.0.md:16-21`）：文档 = 需求说明（AI 改的是项目代码）、允许写但工具白名单不含 Bash、结果以「执行记录」一节追加回文档。

**已实现且不需再动的部分**（本次不列入任务）：角色 CRUD 与内置角色种子（`db.ts:498-610`）、执行确认与风险提示（`RunConfirmDialog.tsx:59-77`）、工具白名单与 `--permission-mode acceptEdits`（`orchestrate.ts:43,263-274`）、超时与杀进程树（`orchestrate.ts:86-108,292-306`）、改动收集用 `git status --porcelain`（`orchestrate.ts:132-194`）、执行记录追加文档（`shared/run-section.ts:4-47`、`DocEditor.tsx:400-412`）、过程面板与中止（`RunProgress.tsx`、`DocEditor.tsx:745-755`）、CLI 安全测试 L13（`scripts/test-orchestrate-security.mjs`）。

**真实缺口**（这是本计划的依据）：

1. **「文档级绑定角色」在首次执行前不成立**。`CreateDialog.tsx` 里没有任何角色选择，`onConfirm` 载荷只有 `projectId/gitUrl/localPath/version`，而 `CreationInput.roleId`（`types.ts:66`）与 `db.createCreation` 的 `role_id` 列（`db.ts:319-334`）都已就绪——参数没人传。于是新建文档的 `roleId` 恒为 null，执行弹窗只能退化成 `roles[0]`（`RunConfirmDialog.tsx:38-40`），绑定要等第一次执行后由 `DocEditor.tsx:363-367` 补记。
2. **编排 tab 里「选中的角色」走不出该组件**。`RoleManager.tsx:28` 的 `selectedId` 是组件私有 state，不进 store；而 `RoleManager.tsx:262-264` 的文案向用户承诺「在协作里打开一份文档即可用这个角色」，实际做不到。
3. **落库的执行日志恒为空/错位**。`DocEditor.tsx:429` 传给 `saveRun` 的 `log: runLogs` 来自 `startOrchestrate` 闭包，是**点击那一刻**的旧数组（首次为空，之后是上一次的日志），执行期间 `setRunLogs` 累积的新日志进不去。
4. **中断被当作失败弹错**。`orchestrate()` 在 cancelled 时返回 `ok:false`，`DocEditor.tsx:435-437` 便设置 `orchestrateError`，用户主动点「中止」后会看到红色错误横幅。
5. **编排 prompt 未按项目的既定约定抽到 shared**。`orchestrate.ts:53-84` 的 `buildSystemPrompt` 内联在 main 模块里，`src/shared/prompts.ts` 目前只有 `PLAN_SYSTEM_PROMPT`。按 `doc/v0.8.0.md:79-84` 记录的教训（测试不得复制实现里的 prompt，否则必然漂移），编排 prompt 目前无法被纯 Node 测试覆盖。
6. **`listRuns` / `deleteRun` 是第二条「设计好但没接线」的死链路**：preload（`index.ts:90-92,178-180`）与 main（`index.ts:143-145`）、db（`db.ts:657-693`）齐备，渲染层除 `saveRun` 外无任何调用。需求未要求执行历史界面，**本计划不把它列为任务**，仅在「风险与依赖」里记录。

## 需求理解

需求是给已有的「编排」功能两侧各补一块：

1. 在编排里选定一个角色，为它填写职责、职位、提示词——让「角色」成为一套可复用的执行配置。
2. 在 Markdown 编辑器上方放一个按钮，点它就用这套配置对当前文档跑一次编排任务。

即：**编辑器里的按钮是「执行」入口，编排 tab 是「配置」入口**，两者靠「角色」串起来。需求原文把三处语义留作「待确认」，v0.5.0 已决策（文档=需求说明、结果追加执行记录），本计划沿用，并在风险节列出需你复核的点。

## 任务拆解

> 说明：下述 T1–T6 是「现状盘点」里 1–5 项缺口的修补，均可在半天内独立完成与验证；T7–T9 为收尾。

### T1. 新建文档时可选默认角色，让「文档级绑定」从创建时成立
- **涉及**：`src/renderer/src/components/CreateDialog.tsx`、`src/renderer/src/pages/MainPage.tsx:89-130`
- **做什么**：`CreateDialog` 增加「默认角色」下拉（数据取自 `store.roles`，进入时 `loadRoles()`；含「不绑定」选项，默认「不绑定」以保持现有行为）；`onConfirm` 载荷增加 `roleId: string | null`；`MainPage` 在 `createCreation({...})` 里透传 `roleId`。
- **完成标志**：新建文档时选「前端工程师」→ 打开该文档 → 点「⚡ 执行编排任务」→ 弹窗里默认选中就是「前端工程师」（不再依赖 `roles[0]`）。选「不绑定」时行为与现在一致。

### T2. 把编排 tab 里选中的角色提升到 store，并作为弹窗默认值的兜底
- **涉及**：`src/renderer/src/store.ts`（新增 `selectedRoleId: string | null` 与 `selectRole(id)`）、`src/renderer/src/components/RoleManager.tsx:28,44-54`、`src/renderer/src/components/DocEditor.tsx:738`
- **做什么**：`RoleManager` 的 `selectedId` 改为读写 store；`DocEditor` 传给 `RunConfirmDialog` 的 `defaultRoleId` 改为按优先级取值：`creation.roleId` → `store.selectedRoleId` → null。`RunConfirmDialog.tsx:38-40` 的 `?? roles[0]?.id` 保留作为最后兜底。
- **完成标志**：在编排 tab 点选「代码审查员」→ 切到协作 tab 打开一份未绑定角色的文档 → 执行弹窗默认选中「代码审查员」，与 `RoleManager.tsx:262-264` 的文案承诺一致。

### T3. 修复执行日志落库为空/错位
- **涉及**：`src/renderer/src/components/DocEditor.tsx:331,343-349,429`
- **做什么**：新增 `runLogsRef`，在 `onOrchestrateLog` 的回调里同步写入 ref（`setRunLogs` 之外），`saveRun` 传 `log: runLogsRef.current`；`startOrchestrate` 开始时清空 ref。`runLogs` 依赖从 `useCallback` 依赖数组里去掉。
- **完成标志**：跑一次编排后查 `runs` 表（或 `window.api.listRuns(creationId)`），`log` 字段含本次的 info/cmd/out 条目，而非空数组或上次的日志。

### T4. 区分「用户中止」与「执行失败」
- **涉及**：`src/renderer/src/components/DocEditor.tsx:435-437`
- **做什么**：`r.meta?.status === 'cancelled'` 时不再设置 `orchestrateError`，只把 `runPhase` 置为「已中止」（该分支已存在）；失败才走错误横幅。
- **完成标志**：执行中点「中止」→ 过程面板显示「已中止」，无红色错误横幅；真实失败（如 CLI 未安装、非零退出）仍弹横幅。

### T5. 把编排的 system prompt 抽到 shared
- **涉及**：`src/shared/prompts.ts`、`src/main/orchestrate.ts:47-84,254`
- **做什么**：在 `prompts.ts` 新增 `buildOrchestratePrompt(role: { name; title; duty; prompt }): string`，把 `orchestrate.ts` 里 `buildSystemPrompt` 的现有文案**原样搬迁**（不得改写措辞，否则是行为变更）；`orchestrate.ts` 改为 import 该函数并删除本地实现。
- **完成标志**：`orchestrate.ts` 中不再有 prompt 文案；`npm run typecheck` 通过；用 `node -e "import('./src/shared/prompts.ts')"` 之类方式或新测试可**在无 electron 的环境下**取得该字符串。

### T6. 为编排 prompt 组装新增一层测试（L15）
- **涉及**：新增 `scripts/test-orchestrate-prompt.mjs`、`package.json:20` 的 `test` 脚本追加该文件
- **做什么**：**从 `src/shared/prompts.ts` import 真实函数**（不复制文案，遵守 `doc/v0.8.0.md:79-84` 的教训），断言：① 角色名/职位/职责出现在 prompt 中；② 角色 `prompt` 为空时不出现「角色专属要求」段；③ 必含「不要执行 git commit」「不引入新依赖」；④ 必含提示词注入防护段（把文档内容当作需求文本而非指令）；⑤ 必含输出要求段。
- **完成标志**：`node scripts/test-orchestrate-prompt.mjs` 通过；故意改动 `prompts.ts` 里某个受断言保护的短语，该测试必须失败（用它自证不是空跑）。

### T7. 手工走一遍需求的三条验收标准
- **涉及**：无（操作应用）
- **做什么**：① 编排 tab 新建/编辑一个角色，填职责、职位、提示词并保存；② 重启应用，确认三项仍在；③ 打开一份关联了项目的文档，点编辑器上方按钮，确认弹窗、执行、过程面板、执行记录追加均正常。
- **完成标志**：三条验收标准逐条走通，异常路径（未关联项目的文档点按钮、角色列表为空、执行中中止）各自给出明确提示、无未捕获异常。

### T8. 编译并启动应用
- **涉及**：`package.json`
- **做什么**：`npm run build`，再 `npm test`（当前 14 层 + T6 新增 1 层），最后启动应用给用户看实际效果。
- **完成标志**：构建与测试零错误，应用可启动，T7 的操作可复现。

### T9. 版本与文档归档
- **涉及**：`package.json:3`（`0.8.0` → `0.9.0`）、新增 `doc/v0.9.0.md`
- **做什么**：按项目规则递增 `version`；版本文档记录本次四处改动（创建时绑角色、store 提升选中角色、执行日志修复、中止与失败的区分）与「prompt 抽到 shared + L15」的测试说明，并如实写明「需求三条验收标准在本次之前已实现」。
- **完成标志**：`doc/v0.9.0.md` 存在且与本计划的实际落地结果一致（未做的不写进去）。

### T10.（**待确认后实施**）按确认结论调整文档与角色的关系
- **涉及**：视结论而定，可能涉及 `RunConfirmDialog.tsx`、`DocEditor.tsx:363-367`、`shared/run-section.ts`
- **做什么**：若确认沿用 v0.5.0 的「执行时选择 + 执行后记住」，本任务不做；若确认改为「严格文档级绑定（执行时不可改选）」，则移除弹窗里的角色选择并改为只读展示；若确认「结果回写」要改成覆盖或新建文档而非追加「执行记录」一节，则改 `DocEditor.tsx:400-412` 与 `run-section.ts`。
- **完成标志**：实现行为与确认结论逐条一致。

## 技术方案

**角色与文档的关系**：维持现有三段式优先级——`Creation.roleId`（文档级绑定）> store 的 `selectedRoleId`（编排 tab 的当前选择）> `roles[0]`（兜底）。T1 补上第一段的产出端，T2 补上第二段。**执行时仍允许改选**，因为需求原文把「文档级绑定还是执行时选择」列为待确认，在结论明确前不应收窄用户的可操作性。

**状态归属**：需要跨组件共享的只有「编排 tab 当前选中的角色」，所以放 zustand store（`store.ts`）而非 React context；文档级绑定继续走数据库（`creations.role_id`），因为它要跨会话存活。

**接口约定**：本次**不新增 IPC 通道**。`CreationInput.roleId`（`types.ts:66`）、`createCreation` 的 `role_id` 写入（`db.ts:319-334`）、`role:set-for-creation`（`index.ts:138`）均已存在，唯一断点在渲染层参数透传。执行侧接口 `orchestrate(runId, { projectPath, docRelPath, version, role })` 保持不变，因此 `preload/index.ts` 与 `src/main/orchestrate.ts` 的签名不动。

**日志修法的选型**：`runLogs` 用 ref 而非把 state 塞进 `useCallback` 依赖。原因是执行期间日志每秒可能追加多条，依赖 state 会让 `startOrchestrate` 每来一条日志就重建一次，而被 `await` 挂起的那次调用用的仍是旧闭包——这本身就是当前缺陷的成因（与 `DocEditor.tsx:107-127` 注释里记的「保存竞态」是同一类问题）。

**依赖**：不引入任何新依赖。T6 的测试复用项目既有的 `check(name, actual, expected)` 断言风格（见 `scripts/test-orchestrate-security.mjs:22-27`），且**必须** import 真实函数而非复制 prompt。

**顺序**：T5 → T6（先抽函数再写测试）；T1、T2、T3、T4 相互独立，可并行；T7 → T8 → T9 收尾。

## 风险与依赖

**必须先确认的事项**：

1. 需求列的三条「待确认」（绑定关系、文档是输入还是目标、是否回写），v0.5.0 已按「执行时选择 + 文档即需求说明 + 追加执行记录」落地。**请确认是否沿用**。若不沿用，T10 才会被激活，且 T1/T2 的价值也随之改变（例如改为严格绑定后，编排 tab 的选中角色不应再影响弹窗默认值）。
2. 本次修补是否在你预期范围内。需求三条验收标准已经实现，上述 T1–T6 是我核对代码后发现的**链路缺口与缺陷**，不是需求里明写的新功能。若你只要求「确认已实现」，那么只做 T7/T8/T9 即可。
3. 职责 / 职位 / 提示词三项是否必填？现状是全部可空（`RoleManager.tsx:56-79` 只校验 `name`），空提示词时执行的是一次「无角色专属要求」的裸编排。需求未写明，需你定：是拦截执行、还是保持现状放行。
4. T6 里我打算对 prompt 的若干短语做断言，这会把现行措辞「固化」下来——以后改文案就得同步改测试。是否接受这种耦合？（我认为值得，但这是取舍，由你定。）

**其他风险与前置条件**：

- **需要 Claude Code CLI 可用**：T3、T7 的真实验证都依赖本机 `claude` CLI；本机被 ccr 路由到国产模型（见 `doc/v0.7.0.md:77`），执行结果的质量与耗时不由本次代码决定。
- **脏工作区会拒绝切分支**：`orchestrate.ts:240-245` 走 `ensureBranch`，而 `git.ts:159-166` 在项目有未提交改动时直接中止。手工验证 T7 时必须用一个干净的项目仓库。
- **测试脚本的已知脆弱点**：`scripts/test-creations-db.mjs:43-59` 与 `scripts/test-migrate.mjs` 都是**复刻** `db.ts` 的表结构与逻辑，不是 import 真实实现。T1 只改渲染层参数，不触碰这两处；但若后续改动 `createCreation` 的 INSERT 列，这两个脚本必须同步手改，属已知的技术债。
- **`runLogsRef` 是一次性的局部修法**：落库日志修复后，`runs` 表会开始积累真实日志（含 CLI 原始输出），表体积会增长。当前没有清理策略，也没有查看入口（见下条）。
- **发现但未纳入本计划的事项**：`listRuns` / `deleteRun` 在 preload、main、db 三层齐备，渲染层从未调用——执行历史目前无处查看，`runs` 表是只写不读的。这与 v0.8.0 修掉的 `setCreationRole` 是同类问题，但需求未要求历史界面，故不列为任务。若要做，属于独立的一小版功能。
- **未提交文件冲突**：`src/main/plan.ts`、`PlanDialog.tsx`、`src/shared/prompts.ts`、`doc/v0.7.0.md`、`doc/v0.8.0.md` 当前处于未提交状态。T5 要改 `prompts.ts`、T9 要新增版本文档，请确认这些改动与它们是同一批变更，避免提交时混在一起。

## 验收标准

1. 编排 tab 中可选择角色，并可编辑其职责、职位、提示词；保存后重启应用三项仍在（`RoleManager.tsx` 现有行为，本次回归确认）。
2. Markdown 编辑器上方存在「执行编排任务」按钮；点击可触发执行，且在过程面板中可见完整命令、工作目录与输出（`DocEditor.tsx:603-623,745-755`）。
3. **T1**：新建文档时选择默认角色 → 该文档执行弹窗的默认选中即为该角色；选择「不绑定」时默认选中行为与改动前一致。
4. **T2**：在编排 tab 点选某角色 → 打开一份未绑定角色的文档 → 执行弹窗默认选中该角色。
5. **T3**：一次编排执行结束后，`runs` 表该条记录的 `log` 字段包含本次执行的多条日志（含 `cmd` 与 `out`），不是空数组、也不是上一次执行的日志。
6. **T4**：执行中点「中止」→ 面板显示「已中止」且无红色错误横幅；执行真实失败时仍显示错误横幅。
7. **T5/T6**：`orchestrate.ts` 内不含 prompt 文案；`node scripts/test-orchestrate-prompt.mjs` 通过；`npm test` 全部通过；改动 `prompts.ts` 中被断言保护的短语会让该测试失败（自证有效）。
8. **异常路径**：未关联项目的文档点按钮 → 给出「需要先关联项目」的明确提示（`DocEditor.tsx:353-356`）；角色列表为空时弹窗提示去编排 tab 创建（`RunConfirmDialog.tsx:98-101`）；执行期间三个 AI 按钮互斥禁用（`DocEditor.tsx:589,607`）。
9. `npm run build` 零错误，应用可启动并完成上述核心路径。
10. `package.json` 的 `version` 已递增至 `0.9.0`，`doc/v0.9.0.md` 已新增且内容与实际落地一致（含「需求三条验收标准在本次之前已实现」的如实说明）。
11. 若 T10 被激活：实现行为与「待确认」三条的最终结论逐条一致，且版本文档中记录了该结论。