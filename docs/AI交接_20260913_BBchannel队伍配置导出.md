# AI 交接记录：BBchannel 队伍配置导出（2026年9月13日）

## 本次用户需求

新增“导出 BBchannel 队伍配置文件”功能，使用者可自行选择保存路径。

## 已完成修改

- 在桌面版顶部操作栏加入“导出 BBchannel 队伍配置”按钮。
- 新增 `src/bbchannel.js`，将账本六个从者位导出为 BBchannel 可由“文件”菜单载入的单个队伍 JSON：
  - `servant_0_name` 至 `servant_5_name`；
  - 前排好友位的 `assistIdx`（账本 1 起始转换为 BBC 0 起始）；
  - `assistMode`、`assistEquip`、`usedServant`、`master_equip`、`server` 及 BBC 队伍档案使用的连接默认字段；
  - 空从者位写为 `null`。
- 导出使用已知的 BBC 中文从者名称映射，避免部分 Mooncell 名称差异导致 BBC 无法匹配。
- 好友位可在位置 1–6 的任意位置；仅好友位置无效、好友从者未选、或好友礼装不属于 BBC 可识别的助战礼装模板时，前端会给出明确提示并停止导出，不会伪造错误的助战配置。
- Electron preload 和主进程新增 `bbchannel:export-team-config` IPC：通过系统“另存为”对话框让使用者选择完整导出路径，仅允许 JSON 文件，然后写入所选文件。
- 该功能不会读取、写入或覆盖 BBchannel 的 `scripts_settings.json`，也不会自动写入 BBchannel 安装目录。导出的文件需要使用者在 BBchannel 的“文件”菜单中载入。

## 已修改文件

- `index.html`
- `src/app.js`
- `src/app.standalone.js`（由 `npm run build:standalone` 生成）
- `src/bbchannel.js`
- `desktop/preload.cjs`
- `desktop/main.cjs`
- `tests/bbchannel.test.mjs`
- `tests/desktop.test.mjs`
- `tests/standalone.test.mjs`

## 验证结果

已实际执行并通过：

```powershell
node --check src/app.js
node --check src/bbchannel.js
node --check desktop/main.cjs
node --check desktop/preload.cjs
npm run build:standalone
npm test
npx electron-builder --win dir --x64
```

- `npm test`：61 项通过，0 项失败。
- 已从 `release\win-unpacked\resources\app.asar` 解包检查，确认其中包含导出按钮、前端配置构造器和 Electron 导出 IPC。

## 部署结果

已覆盖部署到：

```text
E:\迦勒底羁绊账本\fgo-bond-ledger
```

部署前确认“迦勒底羁绊账本”进程未运行。为保证 Electron 的 ASAR 完整性，本次成对覆盖并进行 SHA-256 一致性校验：

- `迦勒底羁绊账本.exe`
  - `2181CD08F2C0D6CCFC4D7671FAE073EF7665912F56C9D15BD116623AC20134C5`
- `resources\app.asar`
  - `456A29E8AAF70BDA3C916C2C7BF77BEF24B58BE9075C13A2AB1BF41386F8ADCF`

## 未完成项

- 后续已根据用户反馈修正“好友位仅限前排”的错误限制，详见 `AI交接_20260913_BBchannel后排助战位修正.md`。`
- 账本本身未保存御主礼装和战斗策略；导出档案只能还原当前队伍与好友助战筛选，不能还原完整战斗脚本。
