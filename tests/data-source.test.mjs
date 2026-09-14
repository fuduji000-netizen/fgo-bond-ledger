import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bondGrowthToStageRequirements,
  getGrandBattleAllowedClasses,
  matchesCondition,
  parseBondCraftEssences,
  parseBondEffect,
} from "../src/data-source.js";

test("冠位 Extra 关卡按 I 与 II 限制对应职阶", () => {
  assert.deepEqual(
    getGrandBattleAllowedClasses({ className: "Extra", name: "冠位钻研战〔Extra Ⅰ〕 火Ⅰ" }),
    ["Ruler", "Avenger", "MoonCancer", "Shielder"],
  );
  assert.deepEqual(
    getGrandBattleAllowedClasses({ className: "Extra", name: "冠位钻研战〔Extra Ⅱ〕 风Ⅰ" }),
    ["Alterego", "Foreigner", "Pretender", "Beast"],
  );
});

test("游戏数据累计羁绊值会转换为阶段需求", () => {
  const requirements = bondGrowthToStageRequirements([3500, 12000, 19000, 25000, 27500, 300000, 630000, 940000, 1230000, 1516000]);
  assert.deepEqual(requirements, [3500, 8500, 7000, 6000, 2500, 272500, 330000, 310000, 290000, 286000]);
});

test("礼装索引会从核心表补全星级、Cost 与立绘", () => {
  const craftIndex = "id=7\nname=测试礼装\nname_link=测试礼装\ndes=关卡通关时〔Saber〕职阶获得的牵绊值增加4%\ndes_max=关卡通关时〔Saber〕职阶获得的牵绊值增加20%";
  const craftCore = "id,star,cost,icon\n7,5,12,//media.fgo.wiki/a/b/test.jpg";
  const [craft] = parseBondCraftEssences(craftIndex, craftCore);
  assert.equal(craft.star, 5);
  assert.equal(craft.cost, 12);
  assert.equal(craft.avatar, "https://media.fgo.wiki/a/b/test.jpg");
});

test("礼装条件支持且、或、七骑士与性别", () => {
  const servant = {
    className: "Saber",
    attributes: ["混沌", "恶"],
    gender: "女性",
    traits: ["拥有星之力"],
  };
  assert.equal(matchesCondition(servant, "混沌且七骑士"), true);
  assert.equal(matchesCondition(servant, "秩序的女性"), false);
  assert.equal(matchesCondition(servant, "拥有星之力的从者或恶"), true);
  assert.equal(matchesCondition(servant, "Caster"), false);
});

test("礼装条件会忽略括号内说明，并将拥有星之力映射到副属性星", () => {
  const starServant = { subAttribute: "星", traits: [] };
  const currentHuman = { traits: ["活在当下的人类"] };

  assert.equal(matchesCondition(starServant, "拥有星之力的从者或恶"), true);
  assert.equal(matchesCondition(currentHuman, "活在当下的人类(部分拟似从者、亚从者等)"), true);
  assert.equal(matchesCondition({ subAttribute: "天" }, "拥有星之力的从者"), false);
});

test("礼装效果会保留多个括号条件", () => {
  const effect = parseBondEffect({
    description: "",
    maxDescription: "关卡通关时〔拥有星之力的从者〕或〔恶〕获得的牵绊值增加20%",
  }, true);
  assert.equal(effect.percent, 20);
  assert.equal(effect.condition, "拥有星之力的从者或恶");
});

test("英灵肖像固定点数与灵衣条件会被解析", () => {
  const portrait = parseBondEffect({
    description: "关卡通关时获得的牵绊点数增加50",
    maxDescription: "",
  }, true);
  assert.equal(portrait.percent, 0);
  assert.equal(portrait.flat, 50);
  assert.equal(portrait.parsed, true);

  const needle = parseBondEffect({
    description: "关卡通关时〔持有灵衣之人〕获得的牵绊值增加20%",
    maxDescription: "",
  }, true);
  assert.equal(matchesCondition({ hasCostume: false }, needle.condition), false);
  assert.equal(matchesCondition({ hasCostume: true }, needle.condition), true);
});

test("重复的增加措辞仍会识别为羁绊百分比效果", () => {
  const effect = parseBondEffect({
    description: "关卡通关时获得的牵绊值增加增加5%",
    maxDescription: "",
  }, true);
  assert.equal(effect.percent, 5);
  assert.equal(effect.parsed, true);
});

test("内置快照包含完整羁绊档案、非零礼装 Cost 与多级冠位钻研战", () => {
  const script = readFileSync(new URL("../data/mooncell-snapshot.js", import.meta.url), "utf8");
  const json = script.replace(/^window\.FGO_MOONCELL_SNAPSHOT\s*=\s*/, "").replace(/;\s*$/, "");
  const snapshot = JSON.parse(json);
  const profiles = Object.values(snapshot.profiles);
  assert.ok(snapshot.servants.length >= 481);
  assert.equal(Object.keys(snapshot.profiles).length, snapshot.servants.length);
  assert.ok(profiles.filter((profile) => profile.bondPoints?.length === 10).length >= 470);
  assert.ok(profiles.every((profile) => [0, 10].includes(profile.bondPoints?.length || 0)));
  assert.equal(snapshot.profiles["480"].bondPoints.length, 10);
  assert.ok(["Mooncell", "Atlas Academy"].includes(snapshot.profiles["480"].bondSource));
  assert.ok(snapshot.bondCraftEssences.length > 0);
  assert.ok(snapshot.bondCraftEssences.every((craft) => craft.cost > 0));
  assert.ok(snapshot.bondCraftEssences.every((craft) => parseBondEffect(craft, true).parsed));
  assert.ok(snapshot.grandBattles.every((battle) => battle.name && battle.id));
  assert.equal(new Set(snapshot.grandBattles.map((battle) => battle.id)).size, snapshot.grandBattles.length);
  const saberResearch = snapshot.grandBattles.filter((battle) => battle.className === "Saber" && battle.name.includes("冠位钻研战"));
  assert.ok(saberResearch.length >= 7);
  assert.deepEqual(saberResearch.slice(0, 3).map((battle) => battle.baseBond), [3164, 3385, 3622]);
  assert.deepEqual(saberResearch[0].allowedClasses, ["Saber"]);
  const extraOne = snapshot.grandBattles.find((battle) => battle.name.includes("Extra Ⅰ") && battle.name.includes("钻研战"));
  assert.deepEqual(extraOne.allowedClasses, ["Ruler", "Avenger", "MoonCancer", "Shielder"]);
  const archerResearch = snapshot.grandBattles.find((battle) => battle.className === "Archer" && battle.name.includes("钻研战"));
  assert.match(archerResearch.name, /Archer/);
});
