# GitHub Release 发布与更新资产修复交接记录（2026年9月14日）

## 本次修改

- 已将项目源码推送至 GitHub 仓库的 `main` 与 `codex/quantplatform-core-rebuild` 分支，并保留 `v0.1.1` 与 `v0.1.2` 标签。
- 发现 GitHub Release 会将中文 NSIS 安装包资产名规范化为 `Setup.0.1.1.exe`，而原 `latest.yml` 仍引用中文文件名；这会使通用 HTTPS 更新器无法按清单下载资产。
- 将 Windows 安装包产物名固定为 ASCII 格式 `fgo-bond-ledger-${version}.exe`，更新清单生成脚本改为只接受该精确文件名。
- 项目版本提升至 `0.1.2`，以便已安装的 `0.1.1` 检测到可用更新。
- 更新 README，说明 ASCII 产物名的原因；补充桌面发布测试覆盖产物名和更新清单约定。

## 验证结果

- `npm test`：66/66 通过。
- `node --check desktop/main.cjs`、`node --check src/app.js` 与 `node --check scripts/generate-update-manifest.mjs`：通过。
- `v0.1.1` 已发布，但其安装资产名与原清单不一致，不应作为自动更新的目标版本；`v0.1.2` 已作为修复版本正式发布。

## 发布与收口结果

- 已执行 `npm run dist:win`，生成 `0.1.2` 的 ASCII 资产名安装包、`.blockmap` 和 `latest.yml`。
- 已创建并正式发布 `v0.1.2` Release，上传 `fgo-bond-ledger-0.1.2.exe`、对应 `.blockmap` 与 `latest.yml`。
- 已验证 `releases/latest/download/latest.yml`、安装包和 `.blockmap` 的公开链接均返回 HTTP 200；清单中的版本、文件名和 SHA-512 与本地构建产物一致。
- 本地 `codex/quantplatform-core-rebuild` 已同步到远程发布提交 `0903604d82c023c4b054ddc4bff473971e7f2e48`，工作树干净。

## 后续版本流程

- 修改 `package.json` 版本号后执行 `npm run dist:win`。
- 上传新的 `latest.yml`、ASCII 安装包和 `.blockmap`，创建对应版本标签与 GitHub Release。
- 发布后验证 `releases/latest/download/latest.yml` 以及清单引用的安装包链接。
