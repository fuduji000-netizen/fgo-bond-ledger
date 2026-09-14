# 2026年9月12日：FGO Wiki Cost 规则与当前软件逻辑核对

## 结论

本次 Cost 错误的直接根因不是好友 Cost 开关，而是旧版本把“冠位从者的一张常规礼装”误当成了冠位专用羁绊礼装：

1. 旧版 Cost 函数在 `isGrandServant` 为真时，强制把常规礼装 Cost 置为 0。
2. 旧版编队渲染在冠位分支只渲染两张 `grandCeIds` 冠位专用礼装，隐藏了 `slot.ceId` 对应的常规礼装。
3. 旧版推荐逻辑也把本方冠位位置从常规礼装推荐源中排除，导致推荐时没有为本方冠位从者保留“计入 Cost 的常规礼装位”。

因此，截图中的第一位本方冠位从者本体 Cost 16 被计入，但其已保存的常规礼装 Cost 12 没有显示、也没有计入：

```text
旧版显示合计：16 + 15 + 0 + 24 + 28 + 19 = 102
应计合计：     102 + 第一位常规礼装 12 = 114
```

冠位专用的两张额外羁绊礼装不占 Cost；好友从者及好友礼装也不占本方编队 Cost。

## 规则核对

本次对照的资料入口：

- FGO Wiki：`Cost`
- FGO Wiki：`Grand Graph System`
- Mooncell 中文 Wiki：冠位戴冠战、从者图鉴、礼装索引相关页面

页面正文在本机网络环境下有时无法稳定打开，因此规则同时用截图、游戏界面语义、Mooncell 数据字段和旧代码行为交叉核对。不要把两张冠位专用礼装与常规礼装混为同一类。

### 正确的编队 Cost 公式

对每个编队位置：

```text
本方普通位置 = 从者 Cost + 常规礼装 Cost
本方冠位位置 = 从者 Cost + 常规礼装 Cost
好友位置     = 0
冠位专用两张额外羁绊礼装 = 0
```

总 Cost 是上述各位置实际占用 Cost 项目的总和。Cost 上限只约束实际占用 Cost 的项目。

这里的关键是：冠位身份改变的是礼装槽的数量和礼装类型，不会让冠位从者原本的一张常规礼装变成免费，也不会把常规礼装槽删除。

## 旧版代码证据

旧部署包已提取到：

`C:\Users\fuduj\Documents\ChatGPT\fgo羁绊计算器\tmp_old_asar_inspect`

### 1. Cost 函数错误

旧版 `tmp_old_asar_inspect/src/calculator.js`：

```js
export function calculateFormationSlotCost({
  servantCost = 0,
  regularCeCost = 0,
  isFriend = false,
  isGrandServant = false,
} = {}) {
  if (isFriend) return 0;
  const servant = Math.max(0, numberOr(servantCost));
  const regularCe = isGrandServant ? 0 : Math.max(0, numberOr(regularCeCost));
  return servant + regularCe;
}
```

问题在这一句：

```js
const regularCe = isGrandServant ? 0 : Math.max(0, numberOr(regularCeCost));
```

它把冠位从者的常规礼装 Cost 无条件清零。正确做法是只让调用方不传入冠位专用礼装的 Cost；传入的 `regularCeCost` 无论从者是否冠位都应计入。

### 2. 编队礼装显示错误

旧版 `tmp_old_asar_inspect/src/app.js` 的冠位渲染逻辑为：

```js
const regularCe = !grandServant ? renderCeVisual(...) : "";
...
${grandCraftEssences ? ... : regularCe}
```

这等价于：冠位从者只显示 `grandCeIds` 两张额外礼装，不显示 `slot.ceId` 的常规礼装。截图中第一位冠位从者下方只有两张冠位礼装图标，且卡片显示 `本位 Cost 16`，正好对应这个分支。

### 3. 推荐逻辑遗漏本方冠位常规礼装

旧版 `tmp_old_asar_inspect/src/recommendation.js` 中，本方常规礼装源会跳过本方冠位位置：

```js
if (index === friendIndex || index === ownGrand || !slot.profile) return;
```

随后只为本方冠位位置创建两张 `countsCost: false` 的冠位专用礼装源。因此旧版推荐不会把本方冠位的常规礼装作为一张 `countsCost: true` 的礼装位处理。

## 当前源码对照

当前工作区 `C:\Users\fuduj\Documents\ChatGPT\fgo羁绊计算器` 已经包含对应修正：

### Cost

当前 `src/calculator.js` 的核心逻辑为：

```js
if (isFriend) return 0;
const servant = Math.max(0, numberOr(servantCost));
const regularCe = Math.max(0, numberOr(regularCeCost));
return servant + regularCe;
```

当前 `src/app.js` 的 `getSlotCost` 会从 `slot.ceId` 读取常规礼装 Cost；好友位仍然整体返回 0。`isGrandServant` 参数目前只是遗留的兼容传参，不再用于排除常规礼装 Cost。

### 编队显示

当前 `src/app.js` 会始终先渲染一张常规礼装，再在冠位位置额外渲染两张冠位专用礼装：

```text
常规礼装：slot.ceId，计入本方 Cost
冠位礼装：slot.grandCeIds[0..1]，不计 Cost
```

### 推荐

当前 `src/recommendation.js` 已为本方每个从者建立一张 `countsCost: true` 的常规礼装源；本方冠位从者再增加两张 `countsCost: false` 的冠位专用礼装源。好友的常规礼装和冠位专用礼装均不计 Cost。

## 需要区分的次要问题

这两个问题不造成截图顶部 `102 / 115` 的直接差额，但仍属于冠位常规礼装处理链条上的潜在缺陷，后续应单独修复或补测试：

1. 当前 `src/app.js` 的 `getActiveCeSources()` 在冠位分支只读取 `grandCeIds`，没有同时读取 `slot.ceId`。这会导致冠位常规礼装虽然显示并计 Cost，但其羁绊加成可能没有参与实际加成计算。
2. 当前 `getActiveOwnCeSelections()` 在冠位分支只登记 `grandCeIds`，没有登记 `slot.ceId`。这会影响本方常规礼装的重复装备检查、持有状态校验和推荐应用后的去重。

这两点与“Cost 公式”不同：Cost 主公式当前已正确，但冠位常规礼装的效果读取和占用登记仍应补齐。

## 验证状态

已确认当前构建产物中的 Cost 逻辑与工作区源码一致：

- 工作区测试覆盖：冠位从者 `16 + 12 = 28`。
- 截图组合回归：总 Cost 为 `114`。
- 当前工作区已有 `npm test` 和 standalone 构建验证记录。
- 当前部署包与工作区 `app.asar` 的 SHA-256 一致：
  `1435A2BCE0DDA016A96C81C19DB5EFCBB8F13A82B5F7E23D8E450198DF7D8DF7`

如果运行中的界面仍显示 `102`，优先怀疑运行的是修复前的旧界面或旧进程；截图本身仍然呈现旧版“冠位隐藏常规礼装”的界面结构，而不是当前源码的界面结构。

## 本轮处理边界

本轮只完成 FGO Wiki 规则与代码逻辑的根因核对，没有再次覆盖正在运行的部署目录，也没有结束运行中的软件进程。
