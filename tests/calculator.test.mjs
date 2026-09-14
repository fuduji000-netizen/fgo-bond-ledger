import assert from "node:assert/strict";
import test from "node:test";
import {
  POST_TEN_REQUIREMENTS,
  applyBattles,
  calculateBattleGain,
  calculateBattlePlan,
  calculateFormationSlotCost,
  calculateSlot,
  getFormationBondBonus,
  getCeilingMessage,
  getRemainingToLevelTen,
  getRequirement,
  getRewardForLevel,
  normalizeTeaPotCount,
  normalizeUnlockedLevel,
  progressFromRemaining,
} from "../src/calculator.js";

const profile = { star: 5, bondPoints: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] };
const context = { baseBond: 100, globalBonus: 0, bonusCap: 500, teaPot: false };

test("Lv.10 之后使用 Mooncell 固定阶段需求", () => {
  assert.equal(getRequirement(profile, 10), POST_TEN_REQUIREMENTS[0]);
  assert.equal(getRequirement(profile, 14), POST_TEN_REQUIREMENTS[4]);
  assert.equal(getRequirement(profile, 15), POST_TEN_REQUIREMENTS[5]);
});

test("升级剩余会转换为内部累计牵绊点数", () => {
  assert.equal(progressFromRemaining(profile, 0, 100), 0);
  assert.equal(progressFromRemaining(profile, 0, 40), 60);
  assert.equal(progressFromRemaining(profile, 0, 0), 99);
  assert.equal(progressFromRemaining(profile, 16, 100), 0);
});

test("前排非好友获得个人加成，前排好友提供全队加成", () => {
  assert.deepEqual(getFormationBondBonus({ index: 0, friendIndex: 4, hasFriendServant: false }), { personal: 20, party: 0 });
  assert.deepEqual(getFormationBondBonus({ index: 3, friendIndex: 1, hasFriendServant: true }), { personal: 0, party: 4 });
  assert.deepEqual(getFormationBondBonus({ index: 1, friendIndex: 1, hasFriendServant: true }), { personal: 0, party: 4 });
  assert.deepEqual(getFormationBondBonus({ index: 3, friendIndex: 1, hasFriendServant: false }), { personal: 0, party: 0 });
});

test("加成上限在茶壶翻倍前按场向下取整", () => {
  const result = calculateBattleGain({ baseBond: 101, percentBonus: 900, bonusCap: 500, teaPot: true });
  assert.equal(result.appliedBonus, 500);
  assert.equal(result.beforeTeaPot, 606);
  assert.equal(result.gain, 1212);
});

test("英灵肖像固定牵绊点会在百分比结算后加入并受茶壶翻倍", () => {
  const result = calculateBattleGain({ baseBond: 101, percentBonus: 20, flatBonus: 50, teaPot: true });
  assert.equal(result.beforeTeaPot, 171);
  assert.equal(result.gain, 342);
});

test("编队加成会与其他百分比加成分段结算并显示基础与额外牵绊", () => {
  const frontline = calculateBattleGain({ baseBond: 4748, percentBonus: 75, formationBonus: 24 });
  assert.equal(frontline.baseGain, 4748);
  assert.equal(frontline.formationStage, 5887);
  assert.equal(frontline.gain, 10302);
  assert.equal(frontline.bonusGain, 5554);

  const backline = calculateBattleGain({ baseBond: 4748, percentBonus: 75, formationBonus: 4 });
  assert.equal(backline.gain, 8639);
  assert.equal(backline.bonusGain, 3891);
});

test("calculateSlot 将分段后的单场合计用于场数计算", () => {
  const result = calculateSlot({
    level: 0,
    progress: 0,
    unlockedLevel: 10,
    profile: { star: 5, bondPoints: [10302, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000] },
  }, {
    baseBond: 4748,
    globalBonus: 75,
    formationBonus: 24,
    bonusCap: 500,
    teaPot: false,
  });
  assert.equal(result.battle.gain, 10302);
  assert.equal(result.nextStageBattles, 1);
  assert.equal(result.targetLevel, 10);
  assert.equal(result.battlesNeeded, 54);
});

test("Lv.10 之前的场数会累计计算到达 Lv.10", () => {
  const earlyProfile = { star: 5, bondPoints: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] };
  const result = calculateSlot({
    level: 2,
    progress: 50,
    unlockedLevel: 10,
    profile: earlyProfile,
  }, { ...context, baseBond: 100 });
  assert.equal(getRemainingToLevelTen(earlyProfile, 2, 50), 5150);
  assert.equal(result.targetLevel, 10);
  assert.equal(result.targetRemaining, 5150);
  assert.equal(result.battlesNeeded, 52);
  assert.equal(result.nextStageBattles, 3);
});

test("未到 Lv.10 时可以跨越多个普通阶段", () => {
  const result = applyBattles({ level: 0, progress: 0, unlockedLevel: 10, profile }, context, 4);
  assert.equal(result.slot.level, 2);
  assert.equal(result.slot.progress, 100);
  assert.equal(result.battlesApplied, 4);
  assert.deepEqual(result.rewards.map((entry) => entry.level), [1, 2]);
});

test("Lv.10 之前会自动跳转等级，达到 Lv.10 时不显示上限提示", () => {
  const result = applyBattles({ level: 9, progress: 900, unlockedLevel: 10, profile }, context, 10);
  assert.equal(result.slot.level, 10);
  assert.equal(result.slot.progress, 900);
  assert.equal(result.slot.awaitingUnlock, false);
  assert.equal(result.battlesApplied, 10);
  assert.equal(result.battlesSkipped, 0);
  assert.equal(result.stoppedReason, null);
  assert.deepEqual(result.rewards.map((entry) => entry.level), [10]);
});

test("Lv.10 及以后填满阶段时停留在当前等级，等待手动提高等级", () => {
  const highGainContext = { ...context, baseBond: 2000000 };
  const result = applyBattles({ level: 9, progress: 900, unlockedLevel: 12, profile }, highGainContext, 4);
  assert.equal(result.slot.level, 10);
  assert.equal(result.slot.progress, getRequirement(profile, 10));
  assert.equal(result.slot.awaitingUnlock, true);
  assert.equal(result.battlesApplied, 2);
  assert.equal(result.battlesSkipped, 2);
  assert.match(result.stoppedReason, /Lv\.10/);
});

test("未在游戏内开启下一阶段时不会显示可继续记入的战斗次数", () => {
  const result = calculateSlot({ level: 10, progress: getRequirement(profile, 10), unlockedLevel: 10, awaitingUnlock: true, profile }, context);
  assert.equal(result.battlesNeeded, null);
  assert.equal(result.remaining, 0);
  assert.equal(result.nextLevel, 11);
  assert.equal(result.nextReward[0].name, "圣晶石");
  assert.match(result.ceilingMessage, /游戏内开启后/);
});

test("Lv.10 已有升级进度时应计算剩余战斗场数", () => {
  const requirement = getRequirement(profile, 10);
  const remaining = 839224;
  const result = calculateSlot({
    level: 10,
    progress: requirement - remaining,
    unlockedLevel: 10,
    profile,
  }, { ...context, baseBond: 10890 });
  assert.equal(result.remaining, remaining);
  assert.equal(result.battlesNeeded, 78);
  assert.equal(result.ceilingMessage, null);
});

test("手动提高已到上限的等级后会清除等待解锁提示", () => {
  const reachedCap = applyBattles({
    level: 11,
    progress: getRequirement(profile, 11) - 100,
    unlockedLevel: 12,
    profile,
  }, context, 1);
  assert.equal(reachedCap.slot.level, 11);
  assert.equal(reachedCap.slot.progress, getRequirement(profile, 11));
  assert.equal(reachedCap.slot.awaitingUnlock, true);
  assert.match(reachedCap.stoppedReason, /Lv\.11/);

  const manuallyAdvanced = calculateSlot({
    ...reachedCap.slot,
    level: 12,
    progress: 0,
    awaitingUnlock: false,
  }, context);
  assert.equal(manuallyAdvanced.ceilingMessage, null);
  assert.equal(manuallyAdvanced.battlesNeeded, 13600);
});

test("录入非零升级进度后会解除等待解锁提示", () => {
  const result = calculateSlot({
    level: 12,
    progress: 1,
    unlockedLevel: 12,
    awaitingUnlock: false,
    profile,
  }, context);
  assert.equal(result.ceilingMessage, null);
  assert.equal(result.battlesNeeded, 13600);
});

test("新阶段的升级剩余最大值不是上限提示的依据", () => {
  const result = calculateSlot({
    level: 12,
    progress: 0,
    unlockedLevel: 12,
    awaitingUnlock: false,
    profile,
  }, context);
  assert.equal(result.ceilingMessage, null);
  assert.equal(result.remaining, getRequirement(profile, 12));
  assert.equal(result.battlesNeeded, 13600);
});

test("记入战斗填满 Lv.12 后，手动升至 Lv.13 不会残留上限提示", () => {
  const reachedCap = applyBattles({
    level: 12,
    progress: getRequirement(profile, 12) - 100,
    unlockedLevel: 12,
    awaitingUnlock: false,
    profile,
  }, context, 1);
  assert.equal(reachedCap.slot.level, 12);
  assert.equal(reachedCap.slot.progress, getRequirement(profile, 12));
  assert.equal(reachedCap.slot.awaitingUnlock, true);
  assert.match(reachedCap.stoppedReason, /Lv\.12/);

  const nextStage = calculateSlot({
    ...reachedCap.slot,
    level: 13,
    progress: 0,
    awaitingUnlock: false,
  }, context);
  assert.equal(nextStage.ceilingMessage, null);
  assert.equal(nextStage.remaining, getRequirement(profile, 13));
});

test("Lv.15 在游戏内开启 Lv.16 后才可继续累计", () => {
  const beforeUnlock = calculateSlot({ level: 15, progress: getRequirement(profile, 15), unlockedLevel: 15, awaitingUnlock: true, profile }, context);
  assert.equal(beforeUnlock.battlesNeeded, null);
  assert.match(beforeUnlock.ceilingMessage, /游戏内开启后/);

  const afterUnlock = calculateSlot({ level: 16, progress: 0, unlockedLevel: 16, awaitingUnlock: false, profile }, context);
  assert.equal(afterUnlock.ceilingMessage, "已达到 Lv.16 满绊");
  assert.equal(getCeilingMessage(16, 16), "已达到 Lv.16 满绊");
  assert.equal(normalizeUnlockedLevel(20), 16);
});

test("占星茶壶数量会缩短场数，并优先用于前几场", () => {
  const plan = calculateBattlePlan({
    remaining: 550,
    normalGain: 100,
    teaPotGain: 200,
    teaPotCount: 2,
  });
  assert.deepEqual(plan, {
    battles: 4,
    teaPotBattles: 2,
    normalBattles: 2,
    teaPotPoints: 400,
    remainingAfterTeaPot: 150,
  });

  const teaProfile = { star: 5, bondPoints: [550, 200, 300, 400, 500, 600, 700, 800, 900, 1000] };
  const calculation = calculateSlot({ level: 0, progress: 0, profile: teaProfile }, { ...context, teaPotCount: 2 });
  assert.equal(calculation.normalBattle.gain, 100);
  assert.equal(calculation.teaPotBattle.gain, 200);
  assert.equal(calculation.nextStageBattles, 4);
  assert.equal(calculation.nextStagePlan.teaPotBattles, 2);

  const result = applyBattles({ level: 0, progress: 0, profile: teaProfile }, { ...context, teaPotCount: 2 }, 4);
  assert.equal(result.slot.level, 1);
  assert.equal(result.slot.progress, 0);
  assert.equal(result.battlesApplied, 4);
  assert.equal(result.teaPotBattlesApplied, 2);
});

test("占星茶壶库存只接受非负整数", () => {
  assert.equal(normalizeTeaPotCount(3.9), 3);
  assert.equal(normalizeTeaPotCount(-2), 0);
  assert.equal(normalizeTeaPotCount("无效", 4), 4);
});

test("羁绊奖励包含 Lv.10 礼装与 Lv.15 梦火引导", () => {
  assert.equal(getRewardForLevel(10, 5)[0].name, "专属羁绊礼装");
  assert.equal(getRewardForLevel(15, 5).at(-1).name, "梦火的引导");
  assert.equal(getRewardForLevel(16, 5)[0].name, "圣晶石");
});

test("冠位从者的常规礼装仍计入 Cost，好友位与冠位专用礼装不计", () => {
  assert.equal(calculateFormationSlotCost({ servantCost: 16, regularCeCost: 12 }), 28);
  assert.equal(calculateFormationSlotCost({ servantCost: 16, regularCeCost: 12, isGrandServant: true }), 28);
  assert.equal(calculateFormationSlotCost({ servantCost: 16, regularCeCost: 12, isFriend: true }), 0);
  assert.equal(calculateFormationSlotCost({ servantCost: -1, regularCeCost: -2 }), 0);
});

test("用户反馈的冠位编队 Cost 会将隐藏的常规礼装补计为 114", () => {
  const displayedSlots = [
    calculateFormationSlotCost({ servantCost: 16, regularCeCost: 12, isGrandServant: true }),
    15,
    0,
    24,
    28,
    19,
  ];
  assert.equal(displayedSlots.reduce((total, cost) => total + cost, 0), 114);
});