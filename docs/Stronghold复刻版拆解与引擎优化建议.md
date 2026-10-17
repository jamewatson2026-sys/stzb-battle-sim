# Stronghold-Protocol 复刻版拆解 · 兼「战斗系统」可落地优化建议

> **一句话结论**：他能做到近乎 1:1 复刻，靠的不是"写得快"，而是把**确定性模拟**当成一等公民——固定 1/30 s 步长、全sim 唯一随机源、无墙钟、战场用 JSON（BattleSpec）描述，于是同一份输入在任何机器上跑出**逐位相同**的结果。这条性质又反过来撑起他后面的一切工程手段：黄金摘要、服务器复算客户端战果、跨平台 CI 对拍。
>
> **对你的意义**：你的引擎**已经具备**这条性质的基础（mulberry32 + 事件流 + golden 快照 + 386 条战法数据）。差距不在"要不要确定性"，而在**把确定性变成可审查、可分割、可执行的工程物品**。本文只给能落到你仓库里的改动，不做为了借鉴而借鉴的搬运。
>
> **证据级别**：复刻版结论全部来自本机克隆 `commit 3eced7b`（v0.2.1，2026-10-08 17:45），引用 `文件:行`；你的引擎数据来自本机实测（vitest / 基准脚本 / grep），复现命令见附录 A。

---

## 一、他是如何做到的

### 1.1 进程与栈

| 层 | 实现 | 证据 |
|---|---|---|
| 服务器 | **一个常驻 Node 进程**，`node:http` + `ws`，无框架；静态文件、房间、对局全在内存，重启即结束对局 | `README.md:147`、`docs/ARCHITECTURE.md:26-28` |
| 客户端 | 浏览器**原生 ES modules，无打包器、无构建步骤**（依赖由 `tools/vendor.mjs` 拷进 `public/vendor/`） | `docs/ARCHITECTURE.md:29-30` |
| 渲染 | PixiJS 7 + pixi-spine（Spine 小人）、three.js（官方 3D 棋盘）、Preact + htm（UI） | `package.json` dependencies |
| 类型 | **JS + JSDoc**，`tsc --noEmit --checkJs` 只检查一个切片（`types/`）；ESLint 只当错误用 | `package.json` scripts、`docs/ARCHITECTURE.md:165-167` |
| 战斗模拟 | `server/sim/` **纯 ESM、不含任何 Node API**，以只读方式挂在 `/sim/` 供浏览器加载 | `docs/ARCHITECTURE.md:31-36` |

### 1.2 六个关键机制（这才是"如何做到"的核心）

#### ① 确定性契约：能复刻的前提

- 固定 **1/30 s 步长**、**种子化 PRNG**（mulberry32）、**无墙钟、无 `Math.random`** → 同一 spec + 同一份数据，任何机器上逐位一致。`docs/ARCHITECTURE.md:37-39`
- 随机源被物理隔离成一个文件，文件头直接写明"The ONLY source of randomness in the sim"：`server/sim/rng.js:1`；除 mulberry32 外还提供 `range/pick/shuffle/weighted/state`，以及 **`deriveSeed(seed, salt)`**——为独立的工作单元（如每块战场）派生互不干扰的子种子。
- `server/sim/spec.js:1-16` 定义了 **BattleSpec**：一场战斗的 JSON 描述，`buildBattleSpec(...)` 产出，`createBattleFromSpec(...)` 消费；文件头点明"spec 按构造即 JSON 安全"（undefined/函数消失，Infinity/NaN → null），所以**服务器发出的就是客户端跑的那一份**。

> 这一步是全部后续设计的地基：因为确定性可信，才敢让**每个玩家的浏览器自己算战斗**。

#### ② 客户端算战斗 + 服务器复算（`SP_COMBAT` / `SP_VERIFY`）

- 默认 `SP_COMBAT=client`：各玩家浏览器模拟自己的战场并上报结果，服务器只管经济与回合——"一台低功耗小主机就能开服"。`README.md:39`、`README.md:117`
- `SP_VERIFY=off|sample|all`（默认 sample ≈ 1/8 抽查）：**服务器按同一 spec 复算客户端上报的战果**并比对。`README.md:118`、`docs/ARCHITECTURE.md:33-36`
- 无人类拥有的战斗（bot、掉线者、超时的权威方）由服务器headless 跑同一份 sim。`docs/ARCHITECTURE.md:34-35`

> 这是"确定性"最值钱的一次兑现：**复算即验证**，不需要额外埋点或反作弊协议。

#### ③ 战场描述与数据源分离

- `PlayerBattleInput`（谁、哪一侧、哪些单位、装备、盟约层数、带入的 HP%）→ spec；`BattleResult` 结构固定。`docs/design/engine.md:34-63`
- 数据从 `data/*.json` 来，服务器 `server/data.js` 只加载一次（冻结），sim 通过 `simdata.js` 把记录转成**冻结的引擎定义**（`server/sim/simdata.js`）。`docs/ARCHITECTURE.md:126-140`
- `data/*.json` 由 `tools/build-data.mjs`（4,016 行）从官方数据表 + `docs/research/*.json` **确定性生成**，**永不手改**；改数据＝改构建器，然后 `--offline` 重建 + diff 确认只有预期字段变了。`docs/ARCHITECTURE.md:133-136`、`README.md:199`

#### ④ 技能＝数据（SkillSpec）+ 钩子；内容＝一文件一干员 + 通用兜底

- `SkillSpec`：`kind`（duration/ammo/instant/charges/passive/toggle）、`mods`（声明式数值修正）、`flags`、`targeting`、`attack`、`heal`、`onStart/onEnd/onHit/onAttack/onTick`，外加 `talents: [{ install(battle, unit) }]` 与 `trait` 覆盖。`docs/design/engine.md:144-164`、`server/sim/skills.js:41-45`
- **数值一律来自官方 blackboard（技能数据表）**：`docs/design/engine.md:172` 明写"content must be data-driven from blackboards (numbers never hard-coded when a blackboard key exists)"。真实例子（隐现的 kit，61 行）：`mods: { atkPct: num(bb.atk), batPct: batMod(...) }`、`kind: 'ammo', ammo: num(bb['attack@trigger_time'], 1)`。`server/sim/content/kits/ops/chess_char_1_01-inside.js:5-45`
- **283 个技能不靠巨石文件组织**：`content/kits/ops/` 下 **209 个文件，一文件一干员**（129 棋子 + 9 补位 + 71 自选），注册表 `kits/index.js`，跨 kit 复用的助手按 tier 放 `kits/shared/tier1..6.js`。`server/sim/content/kits/README.md:1-30`
- **兜底路径**：没有专属 kit 的棋子，由 `content/generic.js` 从 blackboard 键推导出一个通用 kit → "so every chess always works"。`docs/design/engine.md:164`
- 职业默认行为（快射手优先打空中、溅射法师、链术师弹射…）**在引擎里实现一次**，kit 只声明差异。`docs/design/engine.md:166`

> 对照你的仓库：你有 **386 条战法的数据**（active 179 / command 119 / passive 61 / pursuit 27）却只有 **21 种 `kind`**——也就是说你的战法已经是"数据 + 一个共用 DSL"，这比他的"一干员一文件"更干净（他们的技能是**每人不同的代码逻辑**）。你要守住的不是"拆成 386 个文件"，而是别让 `kind` 失控增长（见 §四）。

#### ⑤ 钩子总线是唯一扩展点，引擎 helper 是唯一 API

- `battle.on(name, handler, { priority, owner })`，处理器按优先级降序、再按注册序执行；事件表固定：`battleStart / deploy / tick / beforeAttack / attack / hit / damaged / heal / fatal / kill / death / skillStart / skillEnd / ammoUsed / spGain / statusApplied / blocked / enemySpawn / enemyLeak / battleEnd`，每个事件的 `ctx` 形状都写明（如 `hit` 可在减伤前改 `dmg`）。`docs/design/engine.md:89-115`
- **内容不得碰内部**：只能用 `battle.dealDamage / heal / applyStatus / addBuff / spawnToken / spawnEnemy / push / pull / unitsInGrid / foesInRadius / addLayers / loseHp ...`。`docs/design/engine.md:116`
- 优先级被当成协议：`fatal` 的救命钩子从 kit 的 10 … −60，到道具"不死"的 `PRIO_REVIVE` −100，逐档写明谁先谁后。`docs/design/engine.md:103-105`

#### ⑥ 黄金结果：按**内容矩阵**枚举 + 摘要 digest + 反向二跑

- 语料是**内容矩阵**而非手挑用例：151 场固定种子场景，6 族——`roster` 49 场（每个棋子 × 每个可选技能 × 每个模组，575 种配装，11 张地图轮换，真实波次 ×3，每种非领袖敌人作额外 spawn）、`bonds` 46、`fields` 22（每个领袖/联防）、`matches` 18（整局跑到结束，含 bot 局）、`standins` 10、`diy`（自选干员）。`test/golden/README.md` 语料表、`tools/golden.mjs:1-46`
- 每场**压成 digest**（结束时间、tick 数、reason、击杀/漏怪、每玩家经济与伤害、每个单位一行…），存 `test/golden/<family>.json`；`npm test` 只跑 `"fast": true` 的 **62/151** 子集，`GOLDEN_FULL=1` 全跑（约 20 s，4 线程）。`test/golden/README.md`
- digest **故意忽略**：对象键顺序、引擎单位 id、棋盘 uid、**同一 tick 内客户端事件的顺序**（只计数不哈希）、墙钟。`test/golden/README.md`
- **`--twice`**：同一进程内算两遍，**第二遍逆序**，比对——专门抓顺序依赖与状态泄漏。`tools/golden.mjs:13`、`test/golden/README.md`
- 纪律写进流程：**纯重构不许改这些文件**；有意改玩法才 `npm run golden:update`，并在提交信息里**点名哪些场景移动、为什么**；评审看 diff（一场景一块、一单位一行）。`test/golden/README.md` 工作流节

#### ⑦（附）边界与文档也是可执行的

- `tools/check-imports.mjs:1-6`：`server/sim` 被浏览器加载，因此**不得** import 对局层/lobby/HTTP 入口/net 层/`public/`/任何 Node builtin；例外清单（`server/sim/nodeData.js`）由 `test/check-imports.test.js` **钉住**。kit 布局测试还禁止 kit 里出现 Node 专用 import、时钟与 `Math.random`。`docs/ARCHITECTURE.md:159-164`
- 拆大文件的手法：**构造函数留一个文件，方法按目录装载到 prototype，顺序固定，重名即抛错**（0.2.0 用它拆了 `Battle.js` / `Match.js` / `PlayerState.js`）。`docs/ARCHITECTURE.md:64-69`
- 文档即契约：`docs/DESIGN.md` 是索引 → `docs/design/{overview,engine,geometry-time,match,network,client}.md`；模块头部注明自己归哪个 DESIGN 节；**没有来源可依的规则标 `[ASSUMED]`**；每版修订与依据进 `docs/history/<version>.md`；还有一个 `test/helpers/designDocs.js` 把设计文档**按 § 顺序喂给文档测试**。`docs/ARCHITECTURE.md:3-10, 191-193`
- `docs/ARCHITECTURE.md:171-190` 是一张"**想改 X → 从 Y 入手 → 再看 Z**"的定位表——新人/AI 接手成本极低。

### 1.3 规模数字（本机 wc/find 实测）

| 项 | 数值 |
|---|---|
| 模拟层 | `server/sim` 55,281 行；引擎模块普遍 500–900 行，最大单文件 1,770 行（`content/tokens.js`，内容数据） |
| 全 server 最大文件 | 1,903 行（`server/match/bot.js`）；**没有万行文件** |
| 内容 | `content/kits/ops/` 209 个 kit 文件；112 名可招募干员、283 个技能、23 个盟约、56 件装备、40 个策略 |
| 测试 | `test/` 526 个文件，`README.md:192` 称约 **3,170** 项；黄金语料 151 场 |
| CI | Ubuntu + Windows × Node 22/24，跑 `npm ci` + `node --test` + 服务器冒烟 `README.md:201` |

---

## 二、你的战斗系统现状（本机实测，不是印象）

### 2.1 结构基线

| 项 | 数值 | 备注 |
|---|---|---|
| `src/` | 33 个文件 / **33,794 行** | 引擎 17,872 行 |
| `src/engine/action.ts` | **10,432 行 / 225 个顶层函数 / 141 个 `case '`** | 状态分派集中在约 5025–5091 行起的巨 switch |
| `src/data/skills.ts` | **11,684 行**（386 条战法 / 21 种 `kind`） | 490/681 个输出是 `inflict_status` |
| `src/engine/types.ts` | 2,713 行 | SkillOutput 是 discriminated union（好） |
| `src/engine/diagnosis.ts` | 1,947 行 | 因果账本 / 覆盖率 / 克制 / 顺序缺口 |
| `src/engine/combat.ts` | **313 行** | 主循环干净，import 了 action.ts 的 12 个函数（`combat.ts:10`） |
| `tests/` | **262 个文件 / 64,143 行** | 测试:源码 ≈ 1.9:1 |
| `Math.random` | **0 处实际调用**（唯一命中在 `rng.ts:4` 的注释里） | 纪律到位 |

### 2.2 实测结果（两条硬结论）

**① 测试基线：2 红 / 2,778 绿**（`npx vitest run`，262 文件，67.5 s）

```
FAIL tests/battle_sim.test.ts:217        期望 '导入 1 队'，实得 '导入 2 队'
FAIL tests/sim_expectation.test.ts:556   期望 combos.length > 1，实得 1
Test Files  2 failed | 260 passed (262)
Tests       2 failed | 2778 passed (2780)
```

**② 吞吐基准**（10 套 fixture × 300 颗种子 = 3,000 场）

```
2.07 ms/场 · 484 场/秒 · 236 事件/场 · 3,000 场共 6.2 s
```

换算：一次 200 场的"统计胜率"（`web/winRate.ts:19` 的 `WIN_RATE_RUNS`）≈ **0.41 s**；`pickEnemy` 每个候选阵容各跑 20 场（`src/rogue/enemy.ts:104-118`），20 个候选 ≈ 0.83 s。**你 B-01 的 P95 ≤ 500 ms 仍然成立**，但如果哪天要"多候选 × 多场次"，这条会先顶到天花板。

### 2.3 你已经领先的地方（别丢）

- **`diagnosis.ts` 的逐战因果归因，复刻版没有对等物**。我翻遍 `server/sim`、`tools/`、`docs/`：他的"为什么打不过"靠黄金摘要 + `tools/balance.mjs` / `botbench.mjs` / `kit-coverage.mjs` 做统计扫描，没有从事件流反解基线与逐来源贡献的账本。你 `AGENTS.md:10` 那条纪律（**只用既有事件流、不加埋点、不改引擎、不重跑**）正是让这件事长期可行的前提——守住它。
- **事件流是唯一真相**已经落地：`combat.ts` 生成事件 → `report.ts` 渲染 → `stats.ts` 汇总 → `diagnosis.ts` 归因，四个消费者同源。这与他的 `drainEvents()` / snapshot 思路同构，而你多了一层归因。
- **数据即类型**：386 条战法是编译期受 `SkillOutput` union 约束的 TS，有 IDE 补全与重构安全。他用 JSON 是因为数据从官方表**生成**；你的数据是**手工考据**的（`dateyuan/*.md` 为权威），两者约束不同，别照搬格式。

---

## 三、逐条优化建议（按性价比排序）

> 每条格式：**现状（file:line）→ 他的做法 → 改法 → 收益 → 成本 → 验收**。

### P0-1 先决条件：处理 2 个红测试

**现状**：`tests/battle_sim.test.ts:217`、`tests/sim_expectation.test.ts:556` 红（实测见 §2.2）。
**为什么排在最前**：下面 P0-2/P0-3 的所有改动，安全性都建立在"改完能一眼看出是不是我弄坏的"之上。安全网有洞时做重构，等于把两个问题混成一个。
**改法**：要么修，要么按你的 golden 口径确认为"预期变更"并把断言改准（`AGENTS.md:31` 的既有流程）。
**验收**：`npx vitest run` → 2780/2780 绿。

### P0-2 用他的"构造函数 + 方法目录"拆法拆 `action.ts`

**现状**：`src/engine/action.ts` **10,432 行 / 225 个顶层函数 / 141 个状态分支**；`combat.ts:10` 一次性 import 12 个入口；状态分派是一个从 ~5025 行开始的巨 switch。
**他的做法**：`docs/ARCHITECTURE.md:64-69`——0.2.0 拆大文件时**不改行为**：构造函数留在一个文件，方法按域装进目录、按固定顺序挂到 prototype，**重名直接抛错**；拆完 `server/sim/battle/` 16 个文件都在 100–900 行。配套的是黄金摘要保证"拆完 digest 不动"。
**改法**（纯移动，零行为变化）：
1. 建 `src/engine/action/`，按域切：`status.ts`（施加/冲突/递减）、`dot.ts`、`skill.ts`（输出执行）、`treasure.ts`、`damage.ts`（applyDamage/恢复）、`listener.ts`（监听类/回合钩子）、`displacement.ts` 等。
2. `src/engine/action/index.ts` **原样 re-export** 现有的全部名字 → 所有 import 点零改动（`combat.ts:10` 不用动）。
3. 逐个文件搬，**一次一个域，搬完立刻跑测试**。
**收益**：单文件导航与上下文成本（人 + AI 都受益）大幅下降；并行改动冲突面从"一个万行文件"变成"按域文件"。
**成本**：1–2 小时纯搬运；真正风险只有隐藏的模块级可变状态 → 由 P0-3 的逆序二跑兜住。
**验收**：`git diff --stat` 只显示行数从 A 移到 B（无新增逻辑）；`tests/__snapshots__/golden.json` 字节不变；2,780 项测试与拆分前逐项一致。

### P0-3 黄金结果升级：内容矩阵 + digest + 逆序二跑

**现状**：`tests/golden.test.ts:26-41` 把 10 套 fixture 的**完整事件流**塞进 614 KB 的 `golden.json` 做 `toEqual`；`AGENTS.md:31` 给出的再生成方式是"**删掉该文件再跑一次**"——全有全无，没人会去 diff 614 KB。
**他的做法**：`test/golden/README.md` + `tools/golden.mjs`——① 语料按**内容矩阵**自动枚举（每个棋子 × 每个技能 × 每个模组…）；② 每场压成**摘要**（`rngDraws`、每单位一行、伤害/治疗/击杀/漏怪），于是 diff 能读出"**哪个场景的哪个字段从旧值变成新值**"；③ `--twice` 第二遍**逆序**跑，抓顺序依赖；④ 重构不许改 digest，玩法改动 `golden:update` 并点名移动的场景。
**改法**（保留现有 10 套快照不动，新增一层）：
1. 新增 `tests/scenarios.ts`：枚举 `SKILL_REGISTRY` 全量 386 条战法，每条 × 固定 3v3 fixture × 固定种子。
2. 每场压成 digest：`result / rounds / 终局兵力 / 双方总伤害 / 事件类型直方图 / rng 抽签次数`。
3. 新增 `tests/repro_order.test.ts`：现有 `golden.test.ts:59-65` 是"同序跑两遍"，升级为**正序 / 逆序 / 交错**三种顺序比对同一批 fixture 的输出——抓跨场状态泄漏（你的引擎有模块级注册表 `SKILL_REGISTRY` 与 `initHeroDB()`，这条不是假想风险）。
**收益**：386 条战法以后加机制时，失败信息从"某个 614 KB 快照不一致"变成"`skill:jiagong` 的 `damage` 旧→新"；同时把"只改了抽签顺序"这类隐形变更暴露出来。
**成本**：一个枚举文件 + 一个测试文件；386 场 ≈ **0.8 s**（按实测 2.07 ms/场），可进 `npm test`。
**验收**：故意改一条状态数值 → **只有**包含该战法的场景红；逆序二跑绿。

### P1-4 把边界变成可执行检查（他的 `check-imports.mjs`）

**现状**（实测）：
- 引擎 → 数据有 **9 处 import**：`combat.ts:12-13`（`../data/skills`、`../data/hero-utils`）、`action.ts:37`、`report.ts:6`、`diagnosis.ts:26`、`treasure.ts:20`、`treasure-source.ts:7`、`troopBonus.ts:3`、`types.ts:8`。
- **存在反向依赖**：`src/rogue/enemy.ts:3` → `../../web/winRate`。而 `web/winRate.ts` 同一文件里既有**纯跑批**（`playOne:127`、`simulateWinRate:225`）又有 **DOM 面板**（`openWinRatePanel:340`、`rowHtml:311` 直接 `document.*`）。这与你 `AGENTS.md:16`"无任何 UI 依赖"的声明相抵。
**他的做法**：`tools/check-imports.mjs:1-6` 把"谁不能 import 谁"写成脚本，`--strict` 时违规即退 1；例外清单由测试钉住；kit 布局测试额外禁止 kit 里出现 Node 专用 import、时钟、`Math.random`。
**改法**：
1. 加 `scripts/check-imports.mjs` + `tests/boundaries.test.ts`，规则三条：`src/engine/**` 不得 import `web/**` 或 DOM 全局；`src/**` 不得 import `web/**`；`src/data/**` 不得 import `src/engine/**`（数据只被引擎读）。
2. **先跑出违规清单，把现状登记成白名单**（能跑、能看趋势），再逐条还债；第一条还债就是把跑批从 `web/winRate.ts` 提到 `src/`（面板留下只调用）。
**收益**：声明与事实一致；引擎可被 CLI/测试/服务端复用而不拖 DOM；以后新加文件不会悄悄破坏分层。
**成本**：脚本约 60 行；还债是搬运。
**验收**：脚本输出违规清单；白名单清零后退出码 0。

### P1-5 数据可注入（不是把数据搬去 JSON）

**现状**：`combat.ts:66` 直接 `new Map(Object.entries(SKILL_REGISTRY))`——**技能表编译进引擎**；`report.ts:6`、`diagnosis.ts:26` 也各自 import 同一份注册表。
**他的做法**：`server/sim/spec.js:1-16` 的 BattleSpec 只带"用哪张地图、哪个 seed、哪些单位"；战斗从**数据源**取定义（`simdata.js` 转成冻结 def），因此同一份 spec 在服务器与浏览器上跑的是同一份数据，而数据可以整体替换（`--offline` 重建 + diff）。
**改法**（小改，别做大迁移）：`BattleConfig` 加可选 `skills?: Map<string, Skill>`（缺省仍是内置注册表，`combat.ts` 里那一行成为唯一默认值），把 `SKILL_REGISTRY` 从 `report.ts` / `diagnosis.ts` 收窄成参数传入。
**收益**：① 可以拿"**旧数据 + 新引擎**"对拍（版本/赛季差异、回归定位）；② 测试 fixture 能自带 3 条战法的极简表，不再依赖全部 386 条；③ 引擎彻底不依赖数据模块，P1-4 的第一条规则顺手满足。
**成本**：约 1 小时，向后兼容。
**验收**：现有 2,780 项测试 + golden 全绿；新增一个只用 3 条战法的 fixture 能跑通。

### P2-6 数据完整性校验器（把你的录入规则变成机器守的）

**现状**：`AGENTS.md:59` 的录入规则（受属性缩放的段成长率留空 → 必须登记 `listing.ts` 下架）、`AGENTS.md:308-314`（只做现有机制能做的 / 每战法 3 测试 / 部分实现一律不录）——**全靠人记**。
**他的做法**：`data/*.json` 一律由构建器生成，`docs/DATA.md` 逐字段定义，验证手段是"重建 `--offline` 再 diff"。
**改法**：加 `tests/data_integrity.test.ts`，机器检查：① 每条战法引用的 `skillId` 在注册表存在（武将挂槽 ↔ 战法表双向）；② `strategyScaled: true` 但 `growthRate` 缺失的战法**必须**出现在 `listing.ts` 的下架名单里；③ 每个 `StatusType` 都有且只有一个处理器（见 P2-7）；④ `tags` 覆盖冲突判定所需。
**收益**：把"靠人记的口径"变成"提交即拦截"；这正是他 `check-imports` + DATA.md 的组合拳里最能搬的一块。
**成本**：一个测试文件。
**验收**：故意插一条"未下架但缺 growthRate"的战法 → 测试红。

### P2-7 状态分派表化（141 个 case，唯一的大改）

**现状**：`action.ts` 约 5025 行起的 switch，141 个 `case '...'`；490/681 个战法输出是 `inflict_status`。
**他的做法**：`docs/design/engine.md:81-88`——`Buff = { key, source, duration, stacks, refresh, mods, flags, onTick?, onExpire?, tags }`，`mods` 是可加的声明式键表（`atkPct/defPct/dmgTakenMul/dodgePhys/...`），`flags` 是语义标记（stun/freeze/silence/stealth/camou/...），并有一份**状态目录**说明每个键的含义与免疫规则；内容只声明，不实现。
**改法**：**先加穷尽性测试**（`types.ts` 里每个 status 类型必须被处理且只被处理一次，新增类型不写处理器即编译/测试失败），再逐步把"数值型状态"收敛成一张表：`类型 → { mods 字段, 冲突策略, 递减分组 }`，把 `AGENTS.md:145-167` 那套复杂的重复施加/冲突口径从散落的 if 变成表数据。
**收益**：新状态不再复制粘贴；冲突与递减口径集中可审。
**成本**：**高**（这是唯一建议排在 golden 强化之后的大改）。
**验收**：穷尽性测试 + 冲突矩阵测试 + golden 不变。

### P2-8（顺手）把诊断输出也纳入黄金摘要

**现状**：`diagnosis.ts` 有 20 例测试（`tests/diagnosis.test.ts`），但输出文本没有黄金锁定。
**他的做法**：能进 digest 的都进 digest（连 `rngDraws` 都进），让"变化"永远可见。
**改法**：给 2–3 个 fixture 的诊断文本存 digest（不存全文）。
**收益**：重构 P0-2 时，归因口径若被无声改变会立刻暴露——这正是 `AGENTS.md:10`"只用既有事件流"这条纪律的保险丝。
**成本**：极小。

---

## 四、明确**不要**学的（反面清单）

1. **不要引入 1/30 s 定步长实时循环**。他是实时的塔防（单位会走、会阻挡、会推拉），你是**离散回合制**（准备阶段 + 1~8 回合逐个行动，`combat.ts:148-207`）。引入 tick 只会把你的确定性变复杂。
2. **不要建 WebSocket 房间 / 客户端权威 / 服务器复算那一套**。你的用户故事 B-06 明确"离线可模拟"，没有对手方要防。**但**"同一 spec 两处复算比对"的思想可以只用在自测（golden / 对拍），这才是它对你的价值。
3. **不要把 11,684 行 TS 数据搬成 JSON**。他用 JSON 是因为数据从官方表**生成**；你的数据是**考据**来的，类型安全 + IDE 补全 + 编译期校验是你的优势。你缺的是 P1-5（可注入）与 P2-6（校验器），不是格式。
4. **不要为了"一文件一干员"把 386 条战法拆成 386 个文件**。他的技能是**每人不同的代码**，你的战法是**同一 DSL 的数据**——你已经更干净。
5. **不要搬素材/i18n/打包/更新包那套**（460 MB 素材、语言包、增量更新 zip）——与"引擎正确性"无关，只会稀释你的注意力。
6. **⚠️ 不要直接抄它的代码——许可证不兼容**。复刻版是 **GPL-3.0-or-later**（`LICENSE`、`README.md:219`；素材另按 NOTICE.md 不属于 GPL），而你的仓库自编代码走 **MIT**（`AGENTS.md:48`）。把它的代码搬进 MIT 项目会构成许可冲突（MIT 无法满足 GPL 的传染性要求）。**可以学的是架构决策与工程手法，不是代码文本**——本文所有建议都是"用你的代码实现同样的机制"，没有一段是可直接复制的实现。

---

## 五、今天就能做的三件事

| # | 动作 | 预计 |
|---|---|---|
| 1 | 确认/修掉 2 个红测试（`tests/battle_sim.test.ts:217`、`tests/sim_expectation.test.ts:556`） | 半小时 |
| 2 | 新增 `tests/repro_order.test.ts`：同一批 fixture **正序 / 逆序 / 交错**各跑一遍比对输出（约 20 行，照抄现有 `golden.test.ts:59-65` 的写法扩成三种顺序） | 半小时 |
| 3 | 新增 `scripts/check-imports.mjs`：三条规则 + 现状白名单，先让它能跑并打印违规清单 | 1 小时 |

做完这三件，P0-2（拆 `action.ts`）就变成一次"纯移动 + 绿灯"的低风险操作。

---

## 附录 A：复现本文所有结论

```bash
# 0) 复刻版：克隆 + 结构/行数/关键实现点索引（脚本已写好）
node stronghold-recon.mjs            # 输出 ./stronghold-recon/{summary.md,tree.txt,loc.txt,hotspots.txt}
git -C stronghold-recon/repo rev-parse HEAD    # 3eced7bdba5aae11a325bd3dbe66cdf01361d2bd
git -C stronghold-recon/repo log -1 --format='%ci %s'

# 1) 你的引擎：测试基线
cd /c/Users/lai15/Desktop/战斗系统 && npx vitest run --reporter=dot

# 2) 你的引擎：吞吐基准（临时脚本，跑完即删）
cat > .bench-tmp.mts <<'EOF'
import { performance } from 'node:perf_hooks';
import { runBattle } from './src/engine/combat';
import { buildAllFixtures } from './tests/fixtures';
import { initHeroDB } from './src/data/heroes';
await initHeroDB();
const fixtures = Object.entries(buildAllFixtures());
for (let i = 0; i < 50; i++) for (const [, c] of fixtures) runBattle({ ...c, seed: 1000 + i });
const t0 = performance.now(); let ev = 0;
for (let i = 0; i < 300; i++) for (const [, c] of fixtures) ev += runBattle({ ...c, seed: 2000 + i }).events.length;
const ms = performance.now() - t0, n = 300 * fixtures.length;
console.log(`${n} 场 ${ms.toFixed(0)}ms → ${(ms / n).toFixed(2)}ms/场，${(n / ms * 1000).toFixed(0)} 场/秒，${(ev / n).toFixed(0)} 事件/场`);
EOF
npx tsx .bench-tmp.mts && rm .bench-tmp.mts

# 3) 结构数字
find src -name '*.ts' | xargs wc -l | sort -rn | head
grep -c "case '" src/engine/action.ts
grep -o "kind: '[a-z_]*'" src/data/skills.ts | sort | uniq -c | sort -rn
grep -rn "Math\.random" src
```

## 附录 B：证据索引（复刻版）

| 结论 | 出处 |
|---|---|
| 确定性与 1/30 s 定步长 | `docs/ARCHITECTURE.md:37-39` |
| 唯一随机源 + `deriveSeed` | `server/sim/rng.js:1-56` |
| BattleSpec（JSON 化战场） | `server/sim/spec.js:1-16` |
| 客户端算战斗 + `SP_VERIFY` 复算 | `README.md:39,117-118`、`docs/ARCHITECTURE.md:31-36` |
| 钩子总线与事件表 | `docs/design/engine.md:89-116` |
| SkillSpec 与通用兜底 kit | `docs/design/engine.md:144-164` |
| 一文件一干员 + 注册表 + tier 助手 | `server/sim/content/kits/README.md:1-30` |
| 真实 kit（数值全部来自 blackboard） | `server/sim/content/kits/ops/chess_char_1_01-inside.js:5-45` |
| 技能运行时（SP/充能/触发规则/kind） | `server/sim/skills.js:1-45`（SkillSpec 字段表在 `:41`） |
| 黄金语料 151 场 / fast 62 / `--twice` | `test/golden/README.md`、`tools/golden.mjs:1-46` |
| import 边界脚本 | `tools/check-imports.mjs:1-6` |
| 拆大文件的手法（构造函数 + 方法目录） | `docs/ARCHITECTURE.md:64-69` |
| 数据由构建器生成、永不手改 | `README.md:199`、`docs/ARCHITECTURE.md:133-136` |
| `[ASSUMED]` 与 design/history 文档体系 | `docs/ARCHITECTURE.md:3-10,191-193` |

---

## 附录 C：他那套 UI 素材是怎么来的（素材管线）

**第一原则：素材不入库，安装时下载。** `public/assets/`、`public/fonts/` 被 `.gitignore:8-14` 排除；仓库里提交的只有**清单** `data/assets.json`（7,969 个文件 / 463 MiB 的 URL 表，`generator: tools/fetch-assets.mjs`），客户端被要求"只请求清单里出现过的 URL"（`docs/ASSETS.md:5-6`）。

### C.1 上游源（全是社区 dump，不是直接抓官方客户端）

| 源（`tools/assets/sources.mjs` 的 `RAW`） | 提供什么 |
|---|---|
| `yuanyan3060/ArknightsGameResource` (main) | 干员头像 180×180（含 E2）、半身立绘 180×360、技能图标、敌人图标、召唤物头像 |
| `ArknightsAssets/ArknightsAssets2` (**cn** 分支) | **UI 素材主力**：`ui/autochess/**`、`arts/**`、`activity/[uc]act2autochess/**`、`battle/[pack]common/sprites`——主界面 / HUD / 商店面板与卡 / 盟约盘 / 装备槽 / 精英与稀有度 / 机变面板 / 结算 / 备战背景；外加盟约图标、商店道具图标、策略图标、职业与分支职业与战斗卡图标、36 个战斗表情、19 页玩法说明（`docs/ASSETS.md:87-88,116-119`） |
| `ArknightsAssets2` (**voice** 分支) | BGM、UI/战斗/单位音效、干员战斗语音（12 个槽位 × cn/jp/en/kr 可切，`ASSETS.md:94-96`） |
| `fexli/ArknightsResource` (main) | 干员战斗 Spine（Front/Back）、召唤物 Spine |
| `isHarryh/Ark-Models` (main) | 敌人 Spine 模型 + `models_data.json` 索引 |
| `Kengxxiao/ArknightsGameData` (zh_CN) | 索引：`audio_data.json`（音频 bank）、`charword_table.json`（语音槽） |
| `TimWangZi/The-font-of-Arknights` | Bender / Novecento Wide 字体 |
| **本机《明日方舟》客户端（可选）** | 官方 3D 棋盘贴图、三个 autochess UI bundle 的 Sprite、社区 dump 没有的 2 个敌人模型与 39 个召唤物模型（`tools/local-extract/extract.py`） |

### C.2 下载机制（`docs/ASSETS.md:8-71`）

- `npm run assets`（= vendor + fetch-assets）：**16 并发**、每源 **3 次指数退避**；`raw.githubusercontent.com` 失败自动切 **jsDelivr**（`cdn.jsdelivr.net/gh/…`），voice 分支没有 jsDelivr 镜像。
- 国内可用**前缀代理**：`SP_ASSET_SOURCE=mirror` + `SP_GITHUB_PROXY`（默认 `https://gh-proxy.com/`；只有公开 GitHub 下载 URL 会被加前缀，且不会重复加——`tools/assets/sources.mjs:8-58`）。
- **幂等**：磁盘上已有文件按大小账本或格式校验（PNG 签名 + `IEND`、MP3 头、sfnt、atlas 页名、skel 不是 HTML 错误页）跳过；下载先写临时文件再改名，半截文件不会落到最终路径。
- 首跑约 **309 MiB / 5,690 文件**（134 s @ ~3 MB/s），重跑约 1 s；`--offline / --prune / --add-only / --force / --dry-run / --refresh-index` 一应俱全。
- **清单不缩水护栏**：重建时若比现有清单少条目 → 保留现有文件、打印将丢弃的条目、`exit 1`（起因是一个 PR 带过少 42 条音频的清单，`ASSETS.md:30-39`）。

### C.3 后处理——素材"能用"的关键（`docs/ASSETS.md:121-139`）

- **atlas**：补 `size: W,H`（fexli 的 atlas 不带，值从 PNG 头读）、给 Ark-Models 的敌人 atlas 打 `pma: true`（预乘 alpha）、页名安全化。
- **skel**：用客户端同款 `@pixi-spine/runtime-3.8` **在 Node 里解析**每个骨架，抽出动画名/时长/事件/`OnAttack` 时刻/包围盒，再跑**动画角色解析器**（`tools/assets/anim-roles.mjs`）；名字会误导解析器的模型用官方 prefab 的动画表覆盖（`tools/assets/spine.mjs` `PREFAB_SPINE_ROLES`）。
- **字体**：OTF/TTF → **自研 WOFF2 编码器**（Brotli，输出对 Google 参考解码器验证无损；`tools/assets/woff2.mjs`），`fonts.css` WOFF2 优先。
- 图片保持 PNG（转 WebP 需要原生依赖）；唯一例外是 3D 棋盘的 12 张贴图，由 Python 侧写 WebP 副本并用 Pillow 保留透明像素下的 RGB。

### C.4 本机客户端提取（可选路径）

- 依赖 `UnityPy>=1.25 / lz4>=4 / Pillow>=10`（`tools/local-extract/requirements.txt`）；`aklz4.py` 注册官方 **LZ4AK** 变体解码器（算法来自 Ark-Unpacker，BSD-3-Clause）。
- 提取：3D 棋盘材质参数与背景/装置网格（OBJ + prefab 摆放）、**推导 PBR 贴图**（BC5 法线重建 Z、光滑度 → 粗糙度）、2 个敌人模型、39 个召唤物模型、表情与玩法说明页（后两类公开镜像也有，本机版优先，见 issue #42）。
- 产物落 `public/assets/local/**` + `data/local-assets.json`（**每台机器一份、gitignore**；清单里只写"组名 + 文件名"，不写 URL，因此缺了也不影响别人）。

### C.5 验证强度（这一层最值得学，`docs/ASSETS.md:387-403`）

2,211 张 PNG **全量 CRC + inflate** 校验；467 个 MP3 用 ffmpeg **全量解码**；**无头 Chrome 实际加载并播放 529 个 Spine 模型**且无 console 错误；三个 WOFF2 过 Chrome 字体消毒器；**771 条溯源**与官方数据表（`activity_table` / `skill_table` / `models_data.json`）逐条对拍。

### C.6 许可口径（同时也是"为什么能这么干"）

素材 © 上海鹰角网络 / Yostar，**不属于 GPL**，不入库、只在安装时从社区 dump 拉取；GitHub Release 的整合包（约 430 MB）"为了方便玩家"附带，`NOTICE.md` 随包；权利人要求即删；客户端必须显示 credits 屏（`docs/ASSETS.md:404-424`）。

> **对照你的项目**：你的素材口径更简单——`public/portraits/`（319 个文件）等**直接引用官方 CDN**，来源登记在 `NOTICE.md §五 素材来源登记表`（`AGENTS.md:47,51`），没有镜像、清单与后处理。如果哪天需要"素材可换/可校验/可离线"，他这套可以拆成两层照搬：**清单（提交）+ 校验器（跑起来就能发现问题）**——后处理那套（atlas 补 size、骨架解析出动画角色）只在你要接 Spine 时才需要。
