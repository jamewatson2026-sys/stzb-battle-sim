# 2026-10-17 报障诊断：援护（cover）选敌串队

> 报障原话：「这个队伍就出现了好多问题，1.曹操的大将宝物援护我方大营却变成了援护敌方典韦；
> 2.典韦的战法不知为何不会触发反击；3.袁术的援护也错了；我首先觉得袁术的机制大有问题，
> 然后再查大将这件宝物和典韦的机制。都要对照包查看区别」

**一句话结论**：三条症状是**同一个根因** —— `selectAttackTarget`（`src/engine/action.ts`）的援护改写分支
从**攻击者本方**里找援护者、而不是从**被攻击方**里找；于是"护主/一夫当关"这两个援护状态被接成了串队开关。
修好选敌后，典韦【舍身卫主】的反击恢复正常（它的受击判定没有被改过，只是此前普攻根本落不到它身上）。

---

## 1. 复现

| 位 | 红队（我方） | 蓝队（敌方） |
|----|--------------|--------------|
| 大营 | 马谡 h799 · 铁骑兵 · 心战为上/大赏三军/悬权而动 · 徐氏匕首（天资 15%） | 荀彧 h24 · 轻骑兵 · 驱虎吞狼/河内世泽/众谋不懈 · 游飘（筹算 15%） |
| 中军 | 袁术 h790 · 禁卫 · 僭号天子/合纵连横/胜敌益强 · **大将（稳固 20%）** | 司马懿 h807 · 白衣死士 · 其徐如林/神兵天降/久战熟谋 · 徐氏匕首（天资 15%） |
| 前锋 | 典韦 h769 · 长枪兵 · 舍身卫主/一夫当关/恃强淬锋 · 沧海（不屈 9%） | 曹操 h23 · 重骑兵 · 魏武之世/反计之策/单骑救主 · **大将（稳固 20%）** |

脚本：`scripts/_diag_1017.mts`（种子 594723 / 8 回合 / 士气 120 / 40 级 9000 兵，逐事件打印战报）。

**修复前的复现输出（节选，种子 594723）**

```
>>> 荀彧 [normal_attack]
   状态 荀彧 获得：曹操 援護 典韦        ← 蓝方自己人挂上去的「援护」，目标是红方典韦
   普攻命中「曹操」距离3 伤害225         ← 荀彧打自己队友
>>> 曹操 [normal_attack]
   状态 曹操 获得：袁术 援護 曹操        ← 红方袁术被当成蓝方曹操的援护者
   普攻命中「典韦」距离3 伤害395
```

---

## 2. 根因（旧代码，`src/engine/action.ts` 旧 9666–9707）

```ts
// 2. 援护：若目标身上有 cover → 改打援护者
const cover = getStatus(nearest, 'cover');                       // ①
if (cover) {
  const coverer = allies.find(                                     // ②
    (a) => a.alive && a !== nearest && hasStatus(a, 'cover')       // ③
  );
  if (coverer) {
    ctx.events.push({ type: 'status_inflicted', unitId: coverer.general.id,
      statusType: 'cover', detail: `${coverer.general.name} 援護 ${nearest.general.name}` });
    return coverer;
  }
}
```

① `cover` 状态挂在**保护者**身上（`treasure.ts` 护主 → 持有者自己；`舍身卫主` → 典韦自己），
   不在被保护者身上；`getStatus(nearest,'cover')` 查错了对象。
② `allies` 是**攻击者本方**，援护者却应该在**目标方**（`enemies`）里找 → 串队。
③ 只按"谁身上有 cover"匹配，完全不看 `protectId` → 谁的护主都能抢任何人的刀。

**三条报障的对应关系**

| 症状 | 机制解释 |
|------|----------|
| 曹操（蓝前锋，大将护主指向蓝大营荀彧）的护主"跑去援护敌方典韦" | 蓝方普攻时，旧代码在**红方**里找"有 cover 的人" = 典韦（一夫当关），于是把蓝方攻击改打到典韦身上，战报写作"曹操 援護 典韦" |
| 袁术的援护也错了（红方普攻却打成"袁术 援護 曹操"） | 同上反过来：红方普攻时在**蓝方**里找到曹操（大将），改写目标 |
| 典韦的战法不触发反击 | 反击判定在 `applyDamage`（`victim === self`），本身没坏；坏的是**普攻落不到典韦身上**而被改写到别处 → 受击次数被偷走。修复后实测触发率 68.7%（60% × 士气 1.12），与截图里的"当前生效几率 67%"一致 |

---

## 3. 对照包（`scripts/skill_extra.json` / `dateyuan/宝物系统调研.md`）

| 数据 | 包内原文 | 引擎应有语义 |
|------|----------|--------------|
| 大将 1072 · 护主 | 「战斗开始后前 2 回合，**援护我军大营**」 | 只护**本队大营**；保护者 = 宝物持有者本身 |
| 一夫当关 200674 | 「战斗开始后前 2 回合，**援护友军全体**」 | 保护者 = 典韦，无 `protectId`（谁都护） |
| 舍身卫主 200993 | 「受到 2 距离以内敌军的伤害时，有 60% 几率对伤害来源发动一次攻击…位于前锋或中军时，前 3 回合敌军对友军全体造成的**攻击伤害由典韦承担**」 | 受击位（自身）+ 代挡位（**友军全体**，不是大营） |

> 注：护主与一夫当关的"保护者"都是**持有者本人**，区别只在被保护范围（大营 / 全体）。
> 旧代码把"持有者"和"被保护者"彻底弄反了。

---

## 4. 修复

`src/engine/action.ts` `selectAttackTarget`（现 9674 起）：

```ts
// 2. 援护：选中的目标若被【目标方】的 cover 持有者保护 → 普攻改为打那位保护者
const nearest = nearestEnemy(ctx, unit, enemies);
if (nearest) {
  const guard = enemies.find(
    (e) => e.alive && e !== nearest &&
      e.statuses.some((s) => s.type === 'cover' && (!s.protectId || s.protectId === nearest.general.id))
  );
  if (guard) {
    const coverStatus = guard.statuses.find((s) => s.type === 'cover');
    ctx.events.push({ type: 'cover', unitId: guard.general.id, targetId: nearest.general.id,
      skillId: coverStatus && 'sourceSkillId' in coverStatus ? coverStatus.sourceSkillId : undefined });
    return guard;
  }
}
return nearest;   // 兜底：无人援护就打原目标（不再"没找到就随便挑一个"）
```

- 改在**选择层**：普攻从第一步就锁定援护者，追击 / 分兵 / 后续判定都跟着真实目标走。
- 日志事件从 `status_inflicted` 改为 `cover`（与 `applyDamage` 里的代受同一条），战报渲染为「援护：X 为 Y 抵挡普通攻击」，不再伪造"获得状态"。
- `applyDamage` 内的代受兜底**保留**（防其它入口绕过选择层）。

---

## 5. 验证

| 项 | 结果 |
|----|------|
| `tests/cover_targeting.test.ts`（3 例：护主只护本队大营 / 护主不越 `protectId` / 一夫当关只护本方） | 修复后 3/3 通过；**回滚旧代码后 3/3 失败**（先红后绿） |
| 全量 `npx vitest run` | 97 文件 / 897 用例全绿 |
| golden 快照 | 未变（T1~T9 不含宝物/援护） |
| `npx tsc --noEmit` | 仅 3 个既有错误（与本改动无关） |
| 200 局（种子 1~200，用户原阵容） | 普攻 6321 次，同阵营 28 次且**全部由暴走（rampage）造成**；援护代受 482 次；舍身卫主判定 1866 / 成功 1282 = **68.7%**，反击总伤害 617,864 |
| 单局（种子 594723） | 同阵营普攻 **0**；援护 4 次：典韦护袁术 ×2、袁术护马谡 ×2（与"护主只护大营、一夫当关护全体"一致） |

复验脚本：`npx tsx scripts/_verify_cover_1017.mts`。

---

## 6. 已知差异 / 未做

- 伤害数字与截图差 5% 左右（225 vs 236）：用户那队的自由加点、宝物词条具体值未知，机制层一致。
- 未改 `applyDamage` 的代受顺序（仍是"先援护、后暴走目标重定向"）；200 局里同阵营普攻只剩暴走一种合法来源。
- 截图与诊断图保存在本目录：`team-left.png` / `team-blue.png` / `log-part1~3.png`。

---

## 7. 补记：舍身卫主的反击判定到底吃哪些伤害（用户 m00521 追问）

用户口径：「全队受到的攻击伤害都由典韦承担，只要典韦受到了伤害（伤害包括攻击伤害和谋略伤害）就会触发反击判定，怎么会只有普攻判定呢？」

**结论：引擎并没有把判定限制在普攻。** 上一轮回复里那句「普攻落不到典韦身上 → 受击次数被偷走」描述的是**那一局被偷的恰好是普攻**，
不是规则；包内原文是「受到 2 距离以内敌军的**伤害**时」，判定入口 `triggerOnHurt`（`src/engine/action.ts`）对舍身卫主
**没有任何伤害类型过滤**（无 `damageSource` / `damageKind`），唯一门槛是 `sourceMaxDistance: 2`。

探针 `scripts/_probe_sheshen.mts`（4 场景 × 40 局，每场景都有「带舍身卫主 / 不带」两臂）：

| 场景（敌方战法） | 典韦受击 | 其中 | 判定次数 |
|---|---|---|---|
| S1 驱虎吞狼（谋略 153%，全体） | 622 | 普攻 533 + **谋略战法 89** | **622**（89 次的前置伤害就是谋略战法） |
| S2 一骑当千（物理 280%，全体） | 645 | 普攻 544 + **物理战法 101** | **645** |
| S3 密谋定蜀·恐慌（谋略 DoT 跳伤） | 652 | 普攻 536 + **DoT 116** | **652** |
| S4 纯普攻（敌方无战法） | 543 | 普攻 543 | 543 |
| 对照臂（不带舍身卫主） | — | — | **0** |

即：**每受一次伤害 = 一次 60% 判定**，无论普攻 / 物理战法 / 谋略战法 / 持续伤害。

**「承担」的口径**（同一探针 S2）：一骑当千的三目标命中，第 2、3 回合 **51 + 36 次全部改判到典韦**（`redirectAllyPhysical`），
第 4 回合起恢复三名友军均分（承担只在前 3 回合）；而 S1 的谋略战法命中仍均分三人 —— **承担只吃「攻击伤害」，不吃谋略伤害**，
与包内「敌军对友军全体造成的**攻击伤害**由典韦承担」一致。

**距离门槛的实证**：把一骑当千的施法者从「中军（距典韦 2）」换到「大营（距典韦 3）」后，同样的 131 次物理战法命中
**判定 0 次** —— 与「2 距离以内」一致（伤害来源须距舍身卫主 ≤ 2）。

**新增契约测试**：`tests/on_hurt_p1.test.ts`「舍身卫主：反击判定覆盖全部伤害类型」（物理/谋略/普攻/DoT 各 1 次判定 +
来源距离 3 不判定）、`tests/cover_targeting.test.ts` 第 4 例（承担物理战法、不承担谋略战法）。
全量 `npx vitest run` = 97 文件 / 901 用例全绿，golden 未变。

**已知边界（未改）**：`redirectPhysicalHit` 只拿到「受击者」，不知道伤害来源 → 友军被暴走打出的物理伤害也会被承担。
按包内「敌军…造成的攻击伤害」严格口径应当排除，但需要把 source 传进该函数（涉及 6 个调用点），本轮未动。

---

## 8. 补记：援护必须落在「结算层」——连击第二刀 / 追击 跟着走（用户 m00678 二次报障）

用户口径（原话）：「援护机制我的系统没做好，查看一下包内是怎么实现的，援护应该是把所有选取援护目标的友军改为援护者」，
并给出两条实证：①「敌方有连击状态第二次普攻不受援护影响依旧攻击援护目标」；②「虽然第一次普攻是由援护者承担但是追击战法的目标还是没变，
追击战法的目标应该随之变为援护者，也就是跟着普攻的目标走」。

### 8.1 包内文案

`scripts/skill_extra.json` 里三类援护全部只承担**普通攻击**，措辞一致：

| 战法 / 宝物 | 包内原文 | 引擎落点 |
|---|---|---|
| 一夫当关（200674） | 「战斗开始后前2回合，援护友军全体…仅对自身处于前锋位置时生效」 | `cover`（无 `protectId`）+ `casterPositions: ['前锋']` |
| 大将·护主（宝物 1072） | 「战斗开始后前2回合，援护我军大营」 | `cover` + `protectId = 我军大营.id`（`src/engine/treasure.ts`） |
| 援护（通用被动） | 「援护友军单体…持续2回合」 | `cover` + `protectId` 单体 |

包内没有任何「只对第一次普攻生效」的表述 ⇒ 第一条是**实现漏判**，不是设计取舍。

### 8.2 根因（第二次，比 10-17 上午那次更靠里）

上午的修复只把「选敌」修对了阵营，但援护仍然**只在 `selectAttackTarget` 里结算**。而「打谁」这件事有多条入口：

| 入口 | 是否经过 `selectAttackTarget` | 旧行为 |
|---|---|---|
| 单次普攻 | 是 | ✅ 会被改成援护者 |
| **连击第二刀** | **否**（`normalAttack` 只在第一刀前选一次 `target`，两刀共用） | ❌ 第二刀回到被保护者 |
| **劲弩·横扫（sweep）** | **否**（`dealAttack` 内自带一遍 `enemies`） | ❌ 打到被保护者 |
| **追击战法** | **否**（目标 = `normalAttack` 返回的原始 `target`） | ❌ 跟着原目标，不跟援护者 |
| 天子诏令 / 定军山强制目标 | 否（`dealAttack` 内改判） | ❌ 覆盖掉援护 |

即：援护是「**选取**到被保护者就换成保护者」，它必须发生在**本次普攻真正确定打谁之后**，否则任何绕过选敌层的路径都会漏。

### 8.3 修复（单一结算点）

`src/engine/action.ts`：

```ts
function applyCoverRedirect(ctx: CombatContext, victim: UnitState): UnitState {
  const guard = findCoverGuard(ctx, victim);      // 按 victim.side 查本方队伍，匹配 protectId
  if (!guard) return victim;
  ctx.events.push({ type: 'cover', unitId: guard.general.id, targetId: victim.general.id,
                    skillId: /* 保护者身上那条 cover 的 sourceSkillId */ });
  return guard;
}

function dealAttack(ctx, unit, target): UnitState {   // 返回**实际结算目标**
  let victim = decreeForceTarget(...) ?? consumePositionSnipe(...) ?? target;
  victim = applyCoverRedirect(ctx, victim);            // ← 援护在这里
  const distance = distanceBetween(ctx, unit, victim); // ← 距离按援护后的目标算
  const hit = redirectPhysicalHit(ctx, victim) ?? victim;   // ← 舍身卫主承担
  ...
  return hit;
}
```

- `selectAttackTarget` 回归纯「选谁」：挑衅 → `nearestEnemy`，**不再结算援护**。
- `normalAttack` 不再自己挑目标后直接结算，而是 `dealAttack(ctx, unit, chosen)` 并**返回它的返回值**；
  追击（`triggerPursuitSkill` 的 `hitTarget`）与分兵（`executeSplitAttack`）都用这个返回值
  ⇒ 用户口径「追击战法的目标跟着普攻的目标走」落实为数据流，不再是各写各的。
- 劲弩 sweep 同样走 `dealAttack`，因此横扫命中也受援护约束。

### 8.4 验证

| 项 | 结果 |
|----|------|
| `tests/cover_targeting.test.ts` 新增 2 例：连击每一刀都受援护约束（红颜铁骑 + 一夫当关，20 seed × 2 回合，>30 刀）；追击目标跟随（舍身卫主 + 3 个追击战法，30 seed × 4 回合，>20 次追击命中） | 修复后通过；`git stash` 回滚 `src/engine/action.ts` 后 **5 failed / 1 passed**（含两例新测试），恢复后全绿 |
| 全量 `npx vitest run` | 97 文件 / **903 用例**全绿 |
| `npx tsc --noEmit` | 仅剩 3 个既有错误（`tests/hot_preset_panel.test.ts:95-96`、`tests/rogue/save.test.ts:26`） |
| golden 快照 | 未变（T1~T9 不含援护/宝物） |
| 200 局（种子 1~200，用户原阵容，`scripts/_verify_cover_1017.mts`） | 普攻 6323、同阵营 25（**全部由暴走造成**）、援护代受 477、舍身卫主 1869 判定 / 1284 成功 = 68.7% |
| 单局种子 594723 | 援护 4 次、同阵营普攻 0；结果红 [0,0,0] / 蓝 [9000,7928,6712] |

### 8.5 已知边界（未改）

- `redirectPhysicalHit`（舍身卫主承担）仍然只拿到「受击者」，不知道伤害来源 ⇒ 友军被暴走打出的**物理**伤害也会被承担。
- 援护只代受**普通攻击**（`applyDamage` 内 `damageSource === 'basic'`）；物理主动/追击战法由 `redirectAllyPhysical` 承担，两者不重叠。
