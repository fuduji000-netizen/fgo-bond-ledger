import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const indexPath = new URL("../index.html", import.meta.url);
const bundlePath = new URL("../src/app.standalone.js", import.meta.url);
const stylesPath = new URL("../styles.css", import.meta.url);
const snapshotPath = new URL("../data/mooncell-snapshot.js", import.meta.url);

test("本地入口加载经典独立脚本而非浏览器模块", async () => {
  const index = await readFile(indexPath, "utf8");
  const bundle = await readFile(bundlePath, "utf8");

  assert.match(index, /<script src="\.\/src\/app\.standalone\.js(?:\?[^\"]*)?"><\/script>/);
  assert.doesNotMatch(index, /type="module"/);
  assert.doesNotMatch(index, /src="\.\/src\/app\.js"/);
  assert.doesNotMatch(bundle, /^\s*import\s/m);
  assert.doesNotMatch(bundle, /^\s*export\s/m);
});

test("本地入口包含礼装库存与桌面版交互，独立脚本不再暴露开启阶段按钮", async () => {
  const index = await readFile(indexPath, "utf8");
  const bundle = await readFile(bundlePath, "utf8");

  assert.match(index, /id="open-owned-ces"/);
  assert.match(index, /id="owned-ce-modal"/);
  assert.match(index, /id="check-updates"/);
  assert.match(index, /id="open-bbchannel"/);
  assert.match(index, /id="export-bbchannel-team"/);
  assert.match(index, /导出 BBchannel 队伍配置/);
  assert.match(index, /id="bbchannel-assist-mode-modal"/);
  assert.match(index, /id="bbchannel-assist-mode"/);
  assert.match(index, /id="bbchannel-np-level"/);
  assert.match(index, /id="bbchannel-servant-level"/);
  assert.match(index, /id="master-equip"/);
  assert.match(index, /id="master-equip-hint"/);
  assert.doesNotMatch(index, /open-bbc-template-maker|bbc-template-modal|BBC 礼装模板|获取 FGO Wiki 原图|导入到 BBC 礼装目录/);
  assert.match(bundle, /function exportBbchannelTeam\(/);
  assert.match(bundle, /createBbchannelTeamConfig\(/);
  assert.match(bundle, /exportBbchannelTeamConfig\(config\)/);
  assert.match(bundle, /function chooseBbchannelExportOptions\(/);
  assert.match(bundle, /getDefaultBbchannelAssistMode/);
  assert.match(bundle, /getDefaultBbchannelFriendRequirements/);
  assert.match(bundle, /NPlevel/);
  assert.match(bundle, /servantLevel/);
  assert.match(bundle, /function renderMasterEquipOptions\(/);
  assert.match(bundle, /masterEquip/);
  assert.match(bundle, /master_equip/);
  assert.match(bundle, /当前为冠位模式，默认“冠位助战”/);
  assert.match(bundle, /当前为普通模式，默认“从者礼装”/);
  assert.doesNotMatch(bundle, /bbc-template|bbcTemplate|fetchFgoWikiCraftEssenceOriginal|exportBbchannelEquipTemplates/);
  assert.match(index, /id="open-emulator"/);
  assert.match(index, /id="open-tool-paths"/);
  assert.match(bundle, /function openOwnedCePicker\(/);
  assert.match(bundle, /function setupDesktopIntegration\(/);
  assert.doesNotMatch(bundle, /unlock-bond-stage/);
  assert.doesNotMatch(bundle, /unlockNextBondStage/);
  assert.match(index, /牵绊最大化礼装推荐/);
});

test("本地入口包含好友与礼装的独立拖放交互", async () => {
  const bundle = await readFile(bundlePath, "utf8");

  assert.match(bundle, /data-friend-drag-source/);
  assert.match(bundle, /function moveFriendPosition\(/);
  assert.match(bundle, /data-ce-drag-source/);
  assert.match(bundle, /function swapCraftEssences\(/);
  assert.match(bundle, /function getFormationBondSummary\(/);
});

test("从者选择器显示全部结果，好友位整张卡片可拖动但不抢占头像和礼装拖放", async () => {
  const bundle = await readFile(bundlePath, "utf8");

  assert.doesNotMatch(bundle, /\}\)\.slice\(0, 120\)/);
  assert.match(bundle, /data-friend-drop-target=\"true\" draggable=\"\$\{friend \? \"true\" : \"false\"\}\"/);
  assert.match(bundle, /event\.target\.closest\(\"\.servant-picker, \.equipment-item\"\)/);
  assert.match(bundle, /friendSlotNode\.classList\.add\(\"is-dragging\"\)/);
});

test("本地入口使用占星茶壶数量库存并保留旧存档迁移", async () => {
  const index = await readFile(indexPath, "utf8");
  const bundle = await readFile(bundlePath, "utf8");

  assert.match(index, /id="tea-pot-count"/);
  assert.doesNotMatch(index, /id="tea-pot"/);
  assert.match(bundle, /function calculateBattlePlan\(/);
  assert.match(bundle, /teaPotCount/);
  assert.match(bundle, /legacyTeaPot/);
  assert.match(bundle, /teaPotBattlesForRecord/);
  assert.doesNotMatch(bundle, /elements\.teaPot\.checked/);
});

test("本地入口保留使用茶壶开关并按开关决定是否参与计算", async () => {
  const index = await readFile(indexPath, "utf8");
  const bundle = await readFile(bundlePath, "utf8");

  assert.match(index, /id="tea-pot-enabled"/);
  assert.match(index, /使用占星茶壶/);
  assert.match(bundle, /function getActiveTeaPotCount\(/);
  assert.match(bundle, /state\.teaPotEnabled \? normalizeTeaPotCount\(state\.teaPotCount\) : 0/);
  assert.match(bundle, /teaPotEnabled: Boolean\(state\.teaPotEnabled\)/);
});

test("Cost 超限使用页面内提醒，且好友 Cost 设置已移除", async () => {
  const index = await readFile(indexPath, "utf8");
  const bundle = await readFile(bundlePath, "utf8");

  assert.match(index, /id="cost-warning"/);
  assert.match(bundle, /编队 Cost 超出上限/);
  assert.match(bundle, /elements\.costWarning\.classList\.toggle\("hidden", !overCost\)/);
  assert.doesNotMatch(bundle, /alert\([^)]*[Cc]ost/);
  assert.doesNotMatch(index, /count-friend-cost/);
  assert.doesNotMatch(bundle, /elements\.countFriendCost/);
});

test("编队礼装以方形缩略图显示并标记满破，持有礼装清单使用真实图标比例", async () => {
  const css = await readFile(stylesPath, "utf8");
  const bundle = await readFile(bundlePath, "utf8");
  assert.match(css, /\.ce-visual \{[\s\S]*?aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(css, /\.ce-visual img \{[\s\S]*?object-fit:\s*cover;[\s\S]*?object-position:\s*50%\s*75%/);
  assert.match(css, /\.ce-picker-tile \{[\s\S]*?aspect-ratio:\s*132\s*\/\s*144/);
  assert.match(css, /\.owned-ce-tile \{[\s\S]*?aspect-ratio:\s*132\s*\/\s*144/);
  assert.match(css, /\.ce-picker-tile img, \.owned-ce-image img \{[\s\S]*?object-fit:\s*contain;[\s\S]*?object-position:\s*center/);
  assert.match(css, /\.ce-mlb-star/);
  assert.match(bundle, /ce-mlb-star/);
});

test("冠位只显示两张同尺寸礼装，推荐紧跟单场合计", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const css = await readFile(stylesPath, "utf8");
  assert.match(bundle, /const GRAND_CE_SLOTS = 1/);
  assert.match(bundle, /function renderSlotRecommendation\(/);
  assert.doesNotMatch(css, /\.grand-ce-item\s+\.ce-visual\s*\{/);
  assert.match(bundle, /const resultMarkup = friend/);
  assert.match(bundle, /const recommendationMarkup = renderSlotRecommendation\(index\);/);
  assert.ok(bundle.includes("${resultMarkup}${recommendationMarkup}"));
});

test("礼装中文名与别名可被搜索命中", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const snapshot = await readFile(snapshotPath, "utf8");

  assert.match(bundle, /function ceSearchText\(/);
  assert.match(bundle, /\(ce\.aliases \|\| \[\]\)\.join/);
  // 記憶の大図書館 在 Mooncell 数据表里只有日文名，必须补上中文名才能勾选取消。
  assert.match(snapshot, /"id":"2583","name":"记忆的大图书馆"/);
  assert.match(snapshot, /"aliases":\["記憶の大図書館","大图书馆","图书馆"\]/);
  assert.match(snapshot, /"id":"2701","name":"军火经销商"/);
  assert.match(snapshot, /"id":"2607","name":"流转的剑圣"/);
});


test("桌面更新界面显示版本、下载进度并在下载后由用户确认重启安装", async () => {
  const [index, bundle] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(bundlePath, "utf8"),
  ]);

  assert.match(index, /id="update-later"/);
  assert.match(bundle, /function formatDownloadProgress\(/);
  assert.match(bundle, /primaryLabel: "下载更新"/);
  assert.match(bundle, /primaryLabel: "重启并安装"/);
  assert.match(bundle, /laterLabel: "下次退出安装"/);
  assert.match(bundle, /当前运行方式不支持在线更新/);
  assert.match(bundle, /window\.fgoDesktop\.getUpdateStatus\(\)/);
  assert.match(bundle, /window\.fgoDesktop\.downloadUpdate\(\)/);
  assert.match(bundle, /window\.fgoDesktop\.installDownloadedUpdate\(\)/);
  assert.doesNotMatch(bundle, /downloadAndInstall/);
});
