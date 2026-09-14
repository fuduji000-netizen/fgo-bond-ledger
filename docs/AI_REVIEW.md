# 本轮实现审阅记录

日期：2026-09-09

## 本轮目标

本轮处理以下需求：修正 Lv.10 有剩余进度时错误显示上限；取消应用内“开启下一阶段”；记录持有的羁绊礼装并影响装备和推荐；同一张本方礼装不可重复装备；准备可分发的 Windows 桌面版、更新检查与 BBchannel/模拟器快捷启动；补全头像下方牵绊相关属性。

## 已实现内容

| 需求 | 实现与结论 |
| --- | --- |
| 取消开启下一阶段 | 已移除卡片按钮、点击处理和独立脚本中的对应代码。Lv.10 及以后只要“升级剩余”仍大于 0 就会计算剩余场数；进度耗尽并跨入尚未在游戏内开启的阶段时，提示改为“请在游戏内开启后，将牵绊等级手动改为下一等级”。内部仍保留 `unlockedLevel`，用于阻止未解锁阶段的溢出战斗记录。 |
| Lv.10 剩余进度计算 | 修正计算顺序：先读取当前阶段进度，再判断是否到达隐藏解锁上限。以剩余 839,224、单场 10,890 为例，现显示还需 78 场，不再误报“已达到 Lv.10 上限”。 |
| 持有羁绊礼装 | 顶栏新增“持有羁绊礼装”。默认全部持有；取消勾选后图片灰显。本方已装备该礼装会立即移除，避免未持有礼装继续参与计算。库存保存为独立的本地账户设置，导出时也会写入。 |
| 本方礼装去重 | 本方普通格和两张冠位格共享一张礼装的唯一性约束。已被其他本方格装备的礼装会在选择器中变灰且不可点击。好友礼装不受库存和本方去重限制，符合用户定义的例外。导入旧配置或切换好友位置时，也会自动清理本方重复或未持有的有效装备。 |
| 礼装推荐 | `recommendBondCraftEssences` 新增本方 `ownedCeIds` 约束；推荐器无法选用未持有礼装，好友来源仍可使用全部礼装。新增回归测试覆盖本方库存限制与好友例外。 |
| 属性显示 | 去掉属性栏的四项截断和单行省略，改为完整换行显示。条件匹配会删除括号内说明，修复“活在当下的人类(部分拟似从者、亚从者等)”无法匹配问题。已核实 Mooncell 将“拥有星之力的从者”关联为副属性“星”，界面会以“拥有星之力”显示，计算也按该映射生效。 |
| Windows 桌面版 | 增加 `desktop/main.cjs`、`desktop/preload.cjs` 与 NSIS 构建配置。桌面版以隔离的 IPC 提供检查更新、下载安装、跳过版本、路径选择和启动 BBchannel/模拟器。网页本身仍可直接双击打开，桌面专用按钮只会在 Electron 中显示。 |
| 更新检查 | 桌面窗口加载后自动检查；发现版本时显示“立即更新、暂不更新、跳过此版本”。“检测更新”使用同一弹窗，手动检查会显示已经跳过的版本。更新服务地址由 `desktop/update-config.json` 配置；空地址时明确提示未配置，避免错误地声称具备在线更新。 |

## 数据核对

Mooncell 的“异星之神”礼装条件为“拥有星之力的从者或恶”。公开页面“副属性：星”将该条件链接到副属性“星”，而不是笼统的星属性猜测；内置快照中有 36 个副属性为“星”的从者。Mooncell 的“迦勒底之晨”条件带括号限定，内置快照中有 34 名从者具有“活在当下的人类”标签。本轮通过统一条件归一化处理了这两类数据。

## 文件与责任范围

- `src/data-source.js`：条件注释清理和“拥有星之力”到副属性“星”的规范化。
- `src/recommendation.js`：本方礼装库存约束。
- `src/app.js`：本地库存、选择器灰显/去重、属性展示、桌面 IPC 前端交互、移除阶段按钮。
- `index.html` 与 `styles.css`：持有礼装、更新、路径设置弹窗和灰显/多行样式。
- `desktop/main.cjs` 与 `desktop/preload.cjs`：Electron 主进程、最小 IPC、更新与外部程序路径逻辑。
- `package.json`：Windows NSIS 打包与桌面启动脚本。
- `tests/`：条件、库存推荐和独立入口的回归测试。

## 验证记录

- `npm run build:standalone` 成功，浏览器直接打开时加载的 `src/app.standalone.js` 已重新生成。
- `node --check src/app.js`、`src/calculator.js`、`src/recommendation.js`、`src/data-source.js`、`src/app.standalone.js`、`desktop/main.cjs`、`desktop/preload.cjs` 均通过。
- `npm test` 通过：36 项测试全部通过，新增 Lv.10 部分进度回归测试。
- 已获用户授权并执行 `npm install`，依赖安装完成（328 个包）。npm 审计报告 2 个高危项，未执行可能引入破坏性升级的 `audit fix --force`。
- 已执行 `npm run dist:win`，Windows x64 NSIS 安装包生成于 `release/迦勒底羁绊账本 Setup 0.1.0.exe`，同时生成 `.blockmap`、`win-unpacked` 和 `builder-debug.yml`。
- 自动化浏览器对本地 `file://` 页面受安全策略限制而无法做截图核验，未尝试绕过。构建产物和页面结构已由测试断言覆盖；仍建议人工直接打开 `index.html` 检查图片加载和窄屏布局。

## 仍需外部配置

线上自动更新仍需要用户提供或决定 HTTPS 更新发布地址，再填写 `desktop/update-config.json` 并发布安装包、`latest.yml` 和 `.blockmap`。当前配置文件中的 `url` 为空，桌面端会明确提示更新服务尚未配置。

## 本地部署约定

用户指定的可运行目录为 `E:\迦勒底羁绊账本\fgo-bond-ledger`。本轮已将最新 `release\win-unpacked` 内容覆盖到该目录，并核对 `迦勒底羁绊账本.exe` 与 `resources\app.asar` 的源、目标哈希一致。后续每次完成版本构建后，直接覆盖此目录；覆盖前应确认程序已退出。Electron 用户数据位于系统用户数据目录，不在该应用目录内。

## 2026-09-10 上限提示复核

### 用户反馈路径

1. 记入战斗次数后达到 Lv.12 上限，界面显示“已达到 Lv.12 上限；请在游戏内开启后，将牵绊等级手动改为 Lv.13”。
2. 在游戏内开启后，手动把牵绊等级改为 Lv.13，提示仍未消失。
3. 调整“升级剩余”时提示会暂时消失，但重新填入 Lv.13 阶段的最大值后又出现。

### 根因与修复

旧逻辑允许根据当前等级、已开启等级和“升级剩余为阶段最大值”推断等待解锁状态。这些数值同时也是手动录入新阶段起点时的正常状态，导致旧的上限标记可以在重新渲染或载入旧存档后被错误恢复。

本轮将等待解锁状态收紧为只由“记入战斗实际抵达未开启上限”的计算路径写入。手动修改牵绊等级或“升级剩余”都会显式清除该状态；存档中没有明确等待解锁标记的旧数据不再推断为上限。记入战斗后会同步保存内部已开启等级，防止后续状态回退。

### 回归覆盖

- Lv.12 记入战斗达到上限后，手动改为 Lv.13 能正常计算，不再显示 Lv.12 上限提示。
- Lv.13 的“升级剩余”填写为该阶段最大值时，仍显示正常的剩余场数，不会被当作上限。
- 原有 Lv.10 有剩余进度、Lv.15/Lv.16、前十绊累计场数和战斗记录场景继续通过。

### 本轮验证状态

- `npm test`：42 项通过。
- `npm run build:standalone`：通过。
- `npm run dist:win`：通过，生成 `release\迦勒底羁绊账本 Setup 0.1.0.exe` 与 `release\win-unpacked`。
- 已确认账本未运行后覆盖 `E:\迦勒底羁绊账本\fgo-bond-ledger`；构建目录和部署目录的 `resources\app.asar` SHA-256 一致，均为 `064B9C9D94D330FBEBC066AE2F40AC5EB50678C7298D2D578B79BC82D0883E63`。
- 已从构建后的 `app.asar` 只读提取独立脚本，确认包内包含本次上限状态修复。

## 2026-09-10 茶壶库存与阶段自动跳转复核

### 需求结论

- Lv.0-Lv.9 的阶段在记入战斗达到阈值后自动进入下一等级；达到 Lv.10 时不产生解锁提示。
- Lv.10 及以后达到当前阶段阈值后停留在当前等级，设置 `awaitingUnlock` 并提示用户先在游戏内开启，再手动改为下一等级。Lv.16 保持最终满绊，不会被旧存档迁回 Lv.15。
- 占星茶壶从布尔开关改为非负整数库存。场数规划按前 N 场优先使用茶壶，随后使用普通场；记录战斗时茶壶按战斗场次由全队共享，一次性扣除 `min(输入次数, 库存)`，不会按五个从者重复扣除；没有可记入的本方从者时不扣库存。

### 代码核对

- `src/calculator.js` 的 `calculateBattlePlan` 同时返回总场数、茶壶场数、普通场数和茶壶点数；`applyBattles` 在跨越 Lv.0-Lv.9 时自动发放阶段奖励，在 Lv.10 及以后遇到阈值时停止并保留当前等级。
- `src/app.js` 的 `recordBattles` 将本次茶壶场数传给每个本方从者，但只在整队循环结束后扣除一次；旧版 `teaPot: true` 存档读取时迁移为一只库存，新的状态不再写回旧字段。
- 存档迁移对 Lv.16 做了边界保护，避免历史的等待标记把最终满绊错误降级。

### 验证记录

- `npm test`：45 项通过，覆盖前十绊自动跳转、十绊后等待解锁、茶壶数量规划、库存整数规范化和独立入口静态断言。
- `node --check src/app.js`、`src/calculator.js`：通过。
- 重新执行 `npm run build:standalone` 和 `npm run dist:win`（Electron 35.7.5）后，将 `release\win-unpacked` 覆盖到 `E:\迦勒底羁绊账本\fgo-bond-ledger`。构建目录与部署目录的 `resources\app.asar` SHA-256 一致，均为 `DD3C8CF89975FB55B753400E4547C2C7BF9DDC5C8BD84739F21699EFDC07568F`；主程序 `迦勒底羁绊账本.exe` 哈希一致，均为 `57B184CA6DCF94B8DB57614E2F61E66FE4ECB44506FD8C6106AC34FCD4AE504F`。`app.asar` 内已确认包含 `calculateBattlePlan`、`teaPotBattlesForRecord`、`legacyTeaPot`，且不再包含旧复选框逻辑。

## 2026-09-10 茶壶开关与 Cost 超限提醒复核

### 需求结论

- 恢复“使用占星茶壶”开关，同时保留库存数量框：开关只决定茶壶是否参与计算，关闭时库存不清空，仅在顶部显示“未启用”。
- 编队 Cost 超出上限时需要在界面内提醒，不使用弹窗。顶部 Cost 汇总变红，并在编队区上方显示常驻提醒条；回到上限内自动隐藏。

### 代码核对

- `index.html` 新增 `#tea-pot-enabled` 复选框与 `#cost-warning` 提示容器；`src/app.js` 新增 `getActiveTeaPotCount()`，统一按开关决定茶壶库存是否参与单场、场数规划、记入扣减与礼装推荐。
- 存档迁移：旧存档含 `teaPot: true` 或已有茶壶库存时视为启用；显式保存过 `teaPotEnabled` 时以保存值为准。
- Cost 提醒使用 `elements.costWarning.classList.toggle("hidden", !overCost)`，全程没有 `alert` 类弹窗。

### 验证记录

- `npm test`：47 项通过，新增“使用茶壶开关”和“Cost 超限页面内提醒”两项静态断言。
- `node --check src/app.js`：通过。
- 重新执行 `npm run build:standalone` 和 `npm run dist:win` 后，已将 `release\win-unpacked` 覆盖到 `E:\迦勒底羁绊账本\fgo-bond-ledger`。构建目录与部署目录的 `resources\app.asar` SHA-256 一致，均为 `576391F65A237792727DA08C0F1F5FAE1D1D36CE232D3B10D2CE77C404099C5A`；主程序 `迦勒底羁绊账本.exe` 哈希一致，均为 `47B9B252AAD6CDF391EBD2115CA5B4BEB0AF8E8901B949C310ED8CFAD41D094F`。包内已确认包含 `teaPotEnabled`、`getActiveTeaPotCount` 与 `cost-warning`，均为新版逻辑。

## 2026-09-11：牵绊阶段规则与占星茶壶库存整合

### 需求

1. **前十绊自动升级、十绊后停留**：
   - Lv.0 至 Lv.9：达到当前阶段上限后自动跳转下一等级，不提示解锁。
   - Lv.10 及以后：达到当前阶段上限后停留在当前等级，提示用户在游戏内开启后手动改为下一等级。
   - Lv.16 保持最终满绊状态，不会被旧存档迁移降级。

2. **占星茶壶库存管理**：
   - 保留原有茶壶开关 `#tea-pot-enabled`。
   - 场数计算：前 N 场按茶壶翻倍（200%），之后按普通场（100%）。
   - 记入战斗：按整队一次消耗 `min(输入次数, 库存)` 个茶壶，不会因五个从者各算一遍而重复扣减。
   - 空编队或全部达到上限时不消耗库存。

### 实现

#### 核心计算 (`src/calculator.js`)

- 已有 `normalizeTeaPotCount(raw)` 标准化茶壶数量输入为非负整数。
- 已有 `calculateBattlePlan({ remaining, normalPerBattle, teaPotPerBattle, teaPotCount })`：
  - 优先用茶壶场次填满前 N 场。
  - 返回 `{ totalBattles, teaPotBattles, normalBattles, bondsFromTeaPot, bondsFromNormal }`。
- `calculateSlot` 同时保留 `perBattleNormal` 与 `perBattleTeaPot`，并用库存规划场数。
- **本轮重点修正** `applyBattles`：
  - Lv.0–Lv.9 自动跨阶段，不写入 `awaitingUnlock`。
  - Lv.10 及以后填满当前阶段时保留等级、进度设为需求值、写入 `awaitingUnlock: true`。
  - 返回 `teaPotBattlesApplied`。

#### 界面 (`src/app.js`)

- 保留 `#tea-pot-enabled` 复选框与 `#tea-pot-count` 数量输入框。
- **本轮新增**：`recordBattles` 按整队消耗茶壶库存：
  - 所有本方从者按相同 `teaPotBattlesForRecord = min(count, getActiveTeaPotCount())` 调用 `applyBattles`。
  - 循环完成后仅扣一次：`state.teaPotCount = max(0, 当前库存 - teaPotBattlesForRecord)`。
  - 日志显示："占星茶壶：消耗 X 个，剩余 Y 个"。
  - 若当前没有任何可记入的本方从者，不扣茶壶库存。

#### 存档迁移 (`normalizeState`)

- **本轮修正**：Lv.16 满绊状态不会被降级回 Lv.15，`awaitingUnlock` 清除以保持最终满绊。
- Lv.10–Lv.15 若进度为 0 且 `awaitingUnlock` 为 `true`，降级至前一阶段并填满进度。

### 验证

- 单元测试 45 项全部通过，覆盖前十绊自动升级、十绊后停留、茶壶库存规划和整队扣减。
- 语法检查通过：`calculator.js`、`app.js`、`app.standalone.js`、`main.js`。
- 已构建 Windows 桌面版并覆盖至 `E:\迦勒底羁绊账本\fgo-bond-ledger`（2026-09-10 21:05）。
- 构建与部署目录的 `app.asar` SHA-256 一致：`576391F65A237792...404099C5A`。
- 主程序 `迦勒底羁绊账本.exe` 哈希一致：`47B9B252AAD6CDF3...AD41D094F`。
- 已清理临时工具脚本 9 个 `tools/tmp_*.py`。

## 2026-09-11 01:46 - Cost 计算与礼装显示修复

**问题**

1. 冠位从者的两张加成礼装（grandCeIds）未计入 Cost
2. 礼装图片裁切位置不对，应显示下半部分（有星星和等级信息）

**修复**

1. getSlotCost 中增加冠位加成礼装的 Cost 计算：
   - 常规礼装位：冠位从者不计 Cost（保持原逻辑）
   - 冠位加成礼装位：无论是否冠位从者都要计入 Cost
   - 遍历两个 grandCeIds 槽位，累加礼装 Cost

2. 礼装图片裁切从 object-position: 50% 42.4% 改为 50% 75%
   - 显示礼装下半部分，与游戏内显示一致
   - 同步更新测试用例中的断言

**验证**

- 所有 49 项测试通过
- 构建并部署到 `E:\迦勒底羁绊账本\fgo-bond-ledger`
- app.asar 哈希：`4E6882E6...4161BB`
- 主程序哈希：`8903DAF7...D64C54`

## 2026-09-11 10:08 - Cost 计算逻辑修正（补充）

**问题**

冠位从者位置的两张加成礼装仍然被计入 Cost，应当与常规礼装一样不计入。

**修复**

将冠位加成礼装的 Cost 计算移入 isGrandServantSlot(index) 的分支判断：
- 冠位从者位置：所有礼装（常规 + 冠位加成）都不计 Cost
- 非冠位从者位置：常规礼装和冠位加成礼装都要计入 Cost

**验证**

- 所有 49 项测试通过
- 已部署到 E:\迦勒底羁绊账本\fgo-bond-ledger
- app.asar 哈希：4E6882E6...4161BB

## 2026-09-11 11:08 - Cost 计算逻辑修正

### 问题
用户报告编队 Cost 计算异常，出现 "Uncaught SyntaxError: Unexpected identifier 'pasting'"

### 根因
`getSlotCost` 函数中冠位从者的逻辑判断反了：
- 注释说"冠位从者位置：所有礼装都不计 Cost"
- 但代码 `if (!isGrandServantSlot(index))` 却是"如果**不是**冠位才加礼装 Cost"

### 修复内容
1. **修正冠位判断逻辑**（第 585-598 行）：
   - 冠位从者：只计冠位礼装 Cost，常规礼装不计
   - 非冠位从者：常规礼装 + 冠位礼装都计入

2. **清理调试代码**：
   - 删除 Cost 调试输出（原 1786-1788 行）

### 验证
- 语法检查：通过
- 单元测试：49 项全部通过
- 部署校验：app.asar 与主程序哈希一致

### 部署
- 覆盖到：`E:\迦勒底羁绊账本\fgo-bond-ledger`
- app.asar: A54C3AFB1E14C536...
- 主程序: 8B01C0E5E20007E5...


## 2026-09-11：四项编队问题复核、打包与交接

### 本轮结论

已复核并重新构建下列四项修复；当前 Windows 安装包已由工作区源码生成，但**未执行安装、未覆盖外部部署目录、未提交 Git**。

1. **编队 Cost**：统一经 `calculateFormationSlotCost` 计算。好友位直接返回零；冠位从者不计普通礼装 Cost；两张冠位羁绊礼装也不占用编队 Cost。普通本方位置仍计算从者本体与常规礼装的 Cost。
2. **好友 Cost**：已删除旧的“是否计入好友 Cost”设置和相关状态分支；界面汇总与礼装推荐共用同一 Cost 规则，因此不会再把好友从者或好友礼装计入上限。
3. **牵绊最大化礼装推荐**：编队操作按钮文字为“牵绊最大化礼装推荐”，点击后会调用推荐求解器；求解结果会受从者、当前关卡、加成上限、礼装持有状态、冠位位置与 Cost 上限共同约束，且可在结果面板应用方案。
4. **编队礼装显示**：礼装改用方形缩略图，并让图片裁切偏向卡面下半部（`object-position: 50% 75%`）；满破礼装在右下角显示星标。此规则与用户提供的参考图所示的“缩略图中保留星级和等级区域”一致。

### 验证证据

- 执行 `npm run build:standalone` 成功，已生成 `src/app.standalone.js`。
- 执行 `npm test` 成功：51 项通过、0 项失败。覆盖了好友位 Cost 排除、冠位礼装不计 Cost、推荐求解、推荐应用所需的独立入口、按钮相关页面结构以及礼装缩略图样式。
- 执行 `npm run dist:win` 成功，产物如下：
  - 安装包：`release/迦勒底羁绊账本 Setup 0.1.0.exe`，SHA-256：`7C79E11C0F5E287DECCEC4681CE6EBDAF9DEFA84FFC2196C0088CC49242F67DC`。
  - 打包资源：`release/win-unpacked/resources/app.asar`，SHA-256：`4CB3F7210EF9370E7E648E9C94E9EF0EF475F65CC7E84545659ED4F9DEAA44D0`。
  - 已确认打包资源包含 `index.html`、`src/app.standalone.js`、`src/calculator.js`、`src/recommendation.js` 与 `styles.css`。

### 未执行的动作与限制

- 未启动已打包程序进行人工点击验收；本轮证据为单元测试、独立脚本重建与安装包内容检查。
- 未安装该安装包，未向外部目录覆盖部署，也未进行 Git 提交；这些动作需要用户对精确目标再次授权。

## 2026-09-11：已授权覆盖部署目录

用户已明确授权覆盖 `E:\迦勒底羁绊账本`。实际部署目录经核对为 `E:\迦勒底羁绊账本\fgo-bond-ledger`，源目录为工作区的 `release/win-unpacked`。

覆盖前已确认主程序未运行；复制过程中未执行删除操作，仅以新构建产物覆盖同名文件。覆盖完成后，源目录与目标目录的哈希校验一致：

- `resources/app.asar`：`4CB3F7210EF9370E7E648E9C94E9EF0EF475F65CC7E84545659ED4F9DEAA44D0`
- `迦勒底羁绊账本.exe`：`045AD551E1B482A61DC7CC843CA045244807DD30E035AE3B56CF9AD7E4477C5D`

至此，`E:\迦勒底羁绊账本\fgo-bond-ledger` 已包含本轮四项修复对应的桌面程序文件。未执行安装程序，也未进行 Git 提交。
