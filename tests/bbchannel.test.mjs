import assert from "node:assert/strict";
import test from "node:test";
import {
  BbchannelExportError,
  createBbchannelTeamConfig,
  getDefaultBbchannelAssistMode,
  getDefaultBbchannelFriendRequirements,
  normalizeBbchannelAssistMode,
  normalizeBbchannelMasterEquip,
  normalizeBbchannelNpLevel,
  normalizeBbchannelServantLevel,
  resolveBbchannelServantName,
} from "../src/bbchannel.js";

const servants = new Map([
  ["s1", { id: "432", name: "理查一世", title: "理查一世" }],
  ["s2", { id: "284", name: "阿尔托莉雅·卡斯特", title: "阿尔托莉雅·卡斯特·Caster" }],
  ["s3", { id: "410", name: "亚历山德罗·迪·卡利奥斯特罗", title: "亚历山德罗·迪·卡利奥斯特罗" }],
  ["s4", { id: "419", name: "多布雷尼亚·尼基季奇", title: "多布雷尼亚·尼基季奇(Lancer)" }],
  ["s5", { id: "356", name: "宇津见绘里濑", title: "宇津见绘里濑(Avenger)" }],
]);
const slots = [
  { servantId: "s1", ceId: "tea" },
  { servantId: "s2", ceId: "tea" },
  { servantId: "s3", ceId: "tea" },
  { servantId: "s4", ceId: "" },
  { servantId: "s5", ceId: "" },
  { servantId: "", ceId: "" },
];
const getServant = (slot) => servants.get(String(slot?.servantId || "")) || null;

test("导出 BBchannel 队伍档案使用六个位置、零起始助战位和 BBC 默认连接字段", () => {
  const config = createBbchannelTeamConfig({ slots, friendPosition: 3, getServant });

  assert.deepEqual(config, {
    servant_0_name: "理查Ⅰ世",
    servant_1_name: "阿尔托莉雅·Caster",
    servant_2_name: "亚历山德罗·卡里奥斯特罗",
    servant_3_name: "多布雷尼娅·尼基季奇(Lancer)",
    servant_4_name: "宇津见绘里濑(Avenger)",
    servant_5_name: null,
    assistIdx: 2,
    assistMode: "从者礼装",
    master_equip: 0,
    NPlevel: 1,
    usedServant: [0, 1],
    connectMode: "ADB方式",
    snapshotDevice: ["normal", "127.0.0.1:7555"],
    operateDevice: ["normal", "127.0.0.1:7555"],
    specialKeys: [],
    server: "CH",
  });
});

test("御主礼装使用 BBC master_info.json 的 SN 编号并过滤非法值", () => {
  const customConfig = createBbchannelTeamConfig({
    slots,
    friendPosition: 3,
    getServant,
    masterEquip: 17,
  });
  assert.equal(customConfig.master_equip, 17);
  assert.equal(normalizeBbchannelMasterEquip("26"), 26);
  assert.equal(normalizeBbchannelMasterEquip("not-a-number"), 0);
  assert.equal(normalizeBbchannelMasterEquip(999, 17), 17);
});

test("BBC 好友宝具与从者等级条件遵循普通、冠位的默认策略并过滤非法值", () => {
  assert.deepEqual(getDefaultBbchannelFriendRequirements("normal"), { npLevel: 1, servantLevel: null });
  assert.deepEqual(getDefaultBbchannelFriendRequirements("grand"), { npLevel: 5, servantLevel: 120 });
  assert.equal(normalizeBbchannelNpLevel(3), 3);
  assert.equal(normalizeBbchannelNpLevel(8, 5), 5);
  assert.equal(normalizeBbchannelServantLevel(120), 120);
  assert.equal(normalizeBbchannelServantLevel(""), null);
  assert.equal(normalizeBbchannelServantLevel(121), null);
});

test("账本模式映射 BBC 默认助战识别模式，且导出可覆盖默认值", () => {
  assert.equal(getDefaultBbchannelAssistMode("normal"), "从者礼装");
  assert.equal(getDefaultBbchannelAssistMode("grand"), "冠位助战");
  assert.equal(normalizeBbchannelAssistMode("冠位助战"), "冠位助战");
  assert.equal(normalizeBbchannelAssistMode("未知模式", "冠位助战"), "冠位助战");
  const config = createBbchannelTeamConfig({
    slots,
    friendPosition: 3,
    getServant,
    assistMode: "冠位助战",
    npLevel: 5,
    servantLevel: 120,
  });
  assert.equal(config.assistMode, "冠位助战");
  assert.equal(config.NPlevel, 5);
  assert.equal(config.servantLevel, 120);
});

test("BBchannel 名称解析使用已知差异映射和空位回退", () => {
  assert.equal(resolveBbchannelServantName({ id: "154", title: "“山中老人”" }), "山中老人");
  assert.equal(resolveBbchannelServantName({ name: "理查一世" }), "理查Ⅰ世");
  assert.equal(resolveBbchannelServantName({ id: "467", title: "普勒拉蒂" }), "弗朗索瓦·普勒拉蒂");
  assert.equal(resolveBbchannelServantName(null), null);
});

test("好友位可在后排导出，assistIdx 保留 BBC 的零起始六人位置", () => {
  const backlineSlots = slots.map((slot, index) => index === 3 ? { ...slot, ceId: "tea" } : slot);
  const config = createBbchannelTeamConfig({ slots: backlineSlots, friendPosition: 4, getServant });
  assert.equal(config.assistIdx, 3);
  assert.deepEqual(config.usedServant, [0, 1, 2]);
});

test("BBC export no longer requires a friend craft essence", () => {
  assert.throws(
    () => createBbchannelTeamConfig({ slots, friendPosition: 7, getServant }),
    (error) => error instanceof BbchannelExportError && /1–6/.test(error.message),
  );
  assert.throws(
    () => createBbchannelTeamConfig({ slots: [{ servantId: "", ceId: "tea" }, ...slots.slice(1)], friendPosition: 1, getServant }),
    (error) => error instanceof BbchannelExportError && /好友位尚未选择从者/.test(error.message),
  );
  const config = createBbchannelTeamConfig({
    slots: [{ ...slots[0], ceId: "unsupported" }, ...slots.slice(1)],
    friendPosition: 1,
    getServant,
  });
  assert.equal(config.assistIdx, 0);
  assert.equal(config.assistMode, "从者礼装");
  assert.equal(config.NPlevel, 1);
  assert.equal(Object.hasOwn(config, "servantLevel"), false);
  assert.equal(Object.hasOwn(config, "assistEquip"), false);
  assert.equal(config.master_equip, 0);
});
