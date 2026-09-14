# GitHub Release 发布与更新资产修复交接记录（2026年9月14日）

## 本次修改

- 已将项目源码推送至 GitHub 仓库的 `main` 与 `codex/quantplatform-core-rebuild` 分支，并创建 `v0.1.1` 标签。
- 发现 GitHub Release 会将中文 NSIS 安装包资产名规范化为 `Setup.0.1.1.exe`，而原 `latest.yml` 仍引用中文文件名；这会使通用 HTTPS 更新器无法按清单下载资产。
- 将 Windows 安装包产物名固定为 ASCII 格式 `fgo-bond-ledger-${version}.exe`，更新清单生成脚本改为只接受该精确文件名。
- 项目版本提升至 `0.1.2`，以便已安装的 `0.1.1` 检测到可用更新。
- 更新 README，说明 ASCII 产物名的原因；补充桌面发布测试覆盖产物名和更新清单约定。

## 验证结果

- `npm test`：66/66 通过。
- `node --check desktop/main.cjs`、`node --check src/app.js` 与 `node --check scripts/generate-update-manifest.mjs`：通过。
- `v0.1.1` 已发布，但其安装资产名与原清单不一致，不应作为自动更新的目标版本。

## 后续动作

- 需要执行 `npm run dist:win` 生成 `0.1.2` 的 ASCII 资产名安装包、`.blockmap` 和 `latest.yml`。
- 需要提交、推送 `0.1.2` 修正，创建 `v0.1.2` Release，上传上述三项同次构建资产，并验证 `releases/latest/download/latest.yml` 与安装包链接均可访问。
