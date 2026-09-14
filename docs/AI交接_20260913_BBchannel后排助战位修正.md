# AI 交接记录：BBchannel 后排助战位修正（2026年9月13日）

## 用户反馈

用户确认 BBchannel 的助战位可以在后排，之前导出器将好友位限制在前排 1–3 位是错误行为。

## 已完成修复

- `src/bbchannel.js` 的好友位置校验从仅允许 `1–3` 改为允许完整六人队伍的 `1–6`。
- 当好友在后排时，导出的 `assistIdx` 仍按 BBC 规范使用零起始位置：
  - 账本位置 4 → `assistIdx: 3`
  - 账本位置 5 → `assistIdx: 4`
  - 账本位置 6 → `assistIdx: 5`
- 好友在后排时，`usedServant` 正确保留所有已选中的前排己方从者。例如好友在位置 4 时，前三个前排从者导出为 `[0, 1, 2]`。
- 不再显示或要求“先将好友移动到前排”。仅好友位置不在 `1–6`、好友从者为空、或好友礼装不受 BBC 支持时才阻止导出。

## 验证结果

已实际执行：

```powershell
node --check src/bbchannel.js
node --test tests/bbchannel.test.mjs
npm run build:standalone
npm test
npx electron-builder --win dir --x64
```

- `npm test`：62 项通过，0 项失败。
- 已从新构建的 `release\win-unpacked\resources\app.asar` 解包确认，包内为六人位置校验，且不含旧的前排限制文本。

## 部署结果

已覆盖部署到：

```text
E:\迦勒底羁绊账本\fgo-bond-ledger
```

部署前确认“迦勒底羁绊账本”进程未运行。已成对覆盖并校验：

- `迦勒底羁绊账本.exe`
  - `CA4295395A2080901F3CA027724284DFFF65F8055BFD22C2DB158F6161830435`
- `resources\app.asar`
  - `434BD2545906CE7AABA5B0A748D81E012F991C221D84FD8B19074D937786EE5F`

## 说明

本记录修正并取代 `AI交接_20260913_BBchannel队伍配置导出.md` 中“好友位必须在前排”的旧说明；当前实现以本记录为准。
