import assert from "node:assert/strict";
import test from "node:test";
import { calculateBattleGain } from "../src/calculator.js";
import { parseBondEffect } from "../src/data-source.js";
import { recommendBondCraftEssences } from "../src/recommendation.js";

function profile(name, attributes = [], overrides = {}) {
  return {
    name,
    className: "Saber",
    attributes,
    traits: [],
    gender: "",
    cost: 0,
    ...overrides,
  };
}

function slot(servantProfile) {
  return {
    profile: servantProfile,
    level: 0,
    eventBonus: 0,
    guideEnabled: false,
  };
}

function ce(id, name, description, cost = 0) {
  return { id, name, description, maxDescription: "", cost };
}

function bruteForcePartyRecommendation(ceList, { baseBond, partyBonus, formationBonus = 0, bonusCap, teaPot, costCap }) {
  const sources = [
    { owner: "own", countsCost: true },
    { owner: "own", countsCost: true },
    { owner: "friend", countsCost: false },
  ];
  const usedOwn = new Set();
  const usedFriend = new Set();
  let best = 0;

  function visit(sourceIndex, percent, flat, cost) {
    if (sourceIndex >= sources.length) {
      const gain = calculateBattleGain({ baseBond, percentBonus: partyBonus + percent, formationBonus, flatBonus: flat, bonusCap, teaPot }).gain;
      best = Math.max(best, gain * 2);
      return;
    }

    visit(sourceIndex + 1, percent, flat, cost);
    const source = sources[sourceIndex];
    const used = source.owner === "friend" ? usedFriend : usedOwn;
    ceList.forEach((candidate) => {
      if (used.has(candidate.id)) return;
      const nextCost = cost + (source.countsCost ? candidate.cost : 0);
      if (nextCost > costCap) return;
      const effect = parseBondEffect(candidate, true, { isSupport: source.owner === "friend" });
      used.add(candidate.id);
      visit(sourceIndex + 1, percent + effect.percent, flat + effect.flat, nextCost);
      used.delete(candidate.id);
    });
  }

  visit(0, 0, 0, 0);
  return best;
}

test("默认策略会最大化全队非好友位", () => {
  const slots = [
    slot(profile("恶属性从者", ["恶"])),
    slot(profile("善属性从者", ["善"])),
    slot(null),
  ];
  const ceList = [
    ce("evil", "恶属性加成", "关卡通关时〔恶〕获得的牵绊值增加40%"),
    ce("good", "善属性加成", "关卡通关时〔善〕获得的牵绊值增加40%"),
    ce("all", "全队加成", "关卡通关时获得的牵绊值增加10%"),
  ];

  const allTargets = recommendBondCraftEssences({
    ceList,
    slots,
    friendIndex: 2,
    targetIndices: [],
    baseBond: 100,
    costCap: 0,
  });
  const oneTarget = recommendBondCraftEssences({
    ceList,
    slots,
    friendIndex: 2,
    targetIndices: [0],
    baseBond: 100,
    costCap: 0,
  });

  assert.equal(allTargets.status, "ok");
  assert.deepEqual(allTargets.targetIndices, [0, 1]);
  assert.equal(allTargets.totalGain, 336);
  assert.deepEqual(oneTarget.targetIndices, [0]);
  assert.equal(oneTarget.totalGain, 180);
  assert.ok(oneTarget.assignments.some((assignment) => assignment.ceId === "all"));
});

test("前排个人加成与前排好友全队加成会计入礼装推荐", () => {
  const result = recommendBondCraftEssences({
    ceList: [],
    slots: [
      slot(profile("前排目标")),
      slot(profile("好友")),
      slot(null),
      slot(profile("后排目标")),
    ],
    friendIndex: 1,
    targetIndices: [0, 3],
    baseBond: 100,
    costCap: 0,
  });

  assert.equal(result.totalGain, 228);
  assert.deepEqual(result.perSlot.map((entry) => [entry.name, entry.bonus, entry.gain]), [
    ["前排目标", 24, 124],
    ["后排目标", 4, 104],
  ]);
});

test("好友满破午茶时光会按助战 15% 参与推荐", () => {
  const result = recommendBondCraftEssences({
    ceList: [ce("tea", "迦勒底午茶时光", "关卡通关时获得的牵绊值增加5%(助战时增加15%)")],
    slots: [slot(profile("本方从者")), slot(profile("好友从者"))],
    friendIndex: 1,
    targetIndices: [0],
    baseBond: 100,
    costCap: 0,
  });

  assert.equal(result.totalGain, 148);
  assert.equal(result.perSlot[0].bonus, 44);
});

test("本方礼装推荐受持有清单限制，好友礼装不受影响", () => {
  const result = recommendBondCraftEssences({
    ceList: [
      ce("owned", "本方持有", "关卡通关时获得的牵绊值增加10%"),
      ce("locked", "本方未持有", "关卡通关时获得的牵绊值增加30%"),
    ],
    slots: [slot(profile("本方目标")), slot(profile("好友从者"))],
    friendIndex: 1,
    targetIndices: [0],
    baseBond: 100,
    costCap: 0,
    ownedCeIds: ["owned"],
  });

  const ownAssignment = result.assignments.find((assignment) => assignment.owner === "own");
  const friendAssignment = result.assignments.find((assignment) => assignment.owner === "friend");
  assert.equal(ownAssignment.ceId, "owned");
  assert.equal(friendAssignment.ceId, "locked");
});

test("灵衣条件会改变推荐结果", () => {
  const ceList = [
    ce("needle", "至诚的一针", "关卡通关时〔持有灵衣之人〕获得的牵绊值增加20%"),
    ce("generic", "通用加成", "关卡通关时获得的牵绊值增加10%"),
  ];
  const withoutCostume = recommendBondCraftEssences({
    ceList,
    slots: [slot(profile("无灵衣", [], { hasCostume: false })), slot(null)],
    friendIndex: 1,
    targetIndices: [0],
    baseBond: 100,
    costCap: 0,
  });
  const withCostume = recommendBondCraftEssences({
    ceList,
    slots: [slot(profile("有灵衣", [], { hasCostume: true })), slot(null)],
    friendIndex: 1,
    targetIndices: [0],
    baseBond: 100,
    costCap: 0,
  });

  assert.equal(withoutCostume.totalGain, 132);
  assert.equal(withCostume.totalGain, 144);
  assert.equal(withCostume.assignments[0].ceId, "needle");
});

test("英灵肖像固定 +50 会与百分比礼装一起纳入最大化搜索", () => {
  const result = recommendBondCraftEssences({
    ceList: [
      ce("portrait", "英灵肖像", "关卡通关时获得的牵绊点数增加50"),
      ce("percent", "百分比礼装", "关卡通关时获得的牵绊值增加20%"),
    ],
    slots: [slot(profile("目标从者")), slot(null)],
    friendIndex: 1,
    targetIndices: [0],
    baseBond: 100,
    costCap: 0,
  });

  assert.equal(result.totalGain, 170);
  assert.equal(result.perSlot[0].flatBonus, 50);
  assert.equal(result.assignments[0].ceId, "portrait");
});

test("冠位从者在 Cost 不足时仍可使用一张不计 Cost 的冠位礼装（总共两张羁绊加成礼装）", () => {
  const result = recommendBondCraftEssences({
    ceList: [
      ce("grand-a", "冠位加成 A", "关卡通关时获得的牵绊值增加20%", 99),
      ce("grand-b", "冠位加成 B", "关卡通关时获得的牵绊值增加30%", 99),
    ],
    slots: [slot(profile("冠位从者", [], { cost: 10 })), slot(null)],
    friendIndex: 1,
    targetIndices: [0],
    grandOwnIndex: 0,
    baseBond: 100,
    costCap: 10,
  });

  assert.equal(result.finalCost, 10);
  assert.equal(result.totalGain, 156);
  assert.equal(result.assignments.filter((assignment) => assignment.kind === "grand").length, 1);
  assert.ok(result.assignments.every((assignment) => assignment.kind === "grand"));
});

test("冠位从者有一张计 Cost 的常规礼装和一张不计 Cost 的专用礼装（总共两张羁绊加成礼装）", () => {
  const result = recommendBondCraftEssences({
    ceList: [
      ce("regular", "常规礼装", "关卡通关时获得的牵绊值增加10%", 12),
      ce("grand-a", "冠位礼装一", "关卡通关时获得的牵绊值增加30%", 99),
      ce("grand-b", "冠位礼装二", "关卡通关时获得的牵绊值增加20%", 99),
    ],
    slots: [slot(profile("冠位从者", [], { cost: 10 })), slot(null)],
    friendIndex: 1,
    targetIndices: [0],
    grandOwnIndex: 0,
    baseBond: 100,
    costCap: 22,
  });

  assert.equal(result.finalCost, 22);
  assert.equal(result.totalGain, 168);
  assert.equal(result.assignments.filter((assignment) => assignment.kind === "regular").length, 1);
  assert.equal(result.assignments.filter((assignment) => assignment.kind === "grand").length, 1);
  assert.equal(result.assignments.find((assignment) => assignment.kind === "regular")?.ceId, "regular");
});

test("好友冠位从者具有常规礼装格及一张不计 Cost 的专用礼装（总共两张羁绊加成礼装）", () => {
  const result = recommendBondCraftEssences({
    ceList: [
      ce("highest", "最高加成", "关卡通关时获得的牵绊值增加30%"),
      ce("high", "次高加成", "关卡通关时获得的牵绊值增加20%"),
      ce("medium", "普通加成", "关卡通关时获得的牵绊值增加10%"),
      ce("low", "不应成为好友第三格", "关卡通关时获得的牵绊值增加5%"),
    ],
    slots: [slot(profile("本方目标")), slot(profile("好友冠位从者"))],
    friendIndex: 1,
    targetIndices: [0],
    friendGrandServant: true,
    baseBond: 100,
    costCap: 0,
  });

  assert.equal(result.totalGain, 223);
  assert.equal(result.assignments.filter((assignment) => assignment.kind === "grand").length, 1);
  assert.equal(result.assignments.filter((assignment) => assignment.kind === "regular").length, 2);
  assert.ok(result.assignments.some((assignment) => assignment.kind === "regular" && assignment.index === 1 && assignment.countsCost === false));
  assert.ok(!result.assignments.some((assignment) => assignment.ceId === "low"));
});

test("从者本体 Cost 已超限时不会生成不可应用的方案", () => {
  const result = recommendBondCraftEssences({
    ceList: [ce("bonus", "通用加成", "关卡通关时获得的牵绊值增加20%")],
    slots: [slot(profile("目标从者", [], { cost: 12 })), slot(null)],
    friendIndex: 1,
    targetIndices: [0],
    baseBond: 100,
    costCap: 10,
  });

  assert.equal(result.status, "over-cost");
  assert.equal(result.assignments.length, 0);
  assert.match(result.message, /超过上限/);
});

test("全局唯一礼装上界不会剪掉混合百分比与固定点数的最优方案", () => {
  const ceList = [
    ce("flat", "英灵肖像", "关卡通关时获得的牵绊点数增加50", 5),
    ce("eleven", "十一加成", "关卡通关时获得的牵绊值增加11%", 5),
    ce("nineteen", "十九加成", "关卡通关时获得的牵绊值增加19%", 12),
    ce("support", "助战加成", "关卡通关时获得的牵绊值增加4%(助战时增加16%)", 12),
    ce("free", "免费加成", "关卡通关时获得的牵绊值增加2%"),
  ];
  const options = { baseBond: 101, partyBonus: 3, formationBonus: 24, bonusCap: 30, teaPot: true, costCap: 12 };
  const result = recommendBondCraftEssences({
    ceList,
    slots: [slot(profile("目标一")), slot(profile("目标二")), slot(profile("好友"))],
    friendIndex: 2,
    ...options,
  });

  assert.equal(result.isExact, true);
  assert.equal(result.totalGain, bruteForcePartyRecommendation(ceList, options));
});

test("好友位 Cost 永不限制推荐方案", () => {
  const result = recommendBondCraftEssences({
    ceList: [ce("party", "全队加成", "关卡通关时获得的牵绊值增加10%", 5)],
    slots: [
      slot(profile("本方", [], { cost: 10 })),
      slot(profile("好友", [], { cost: 999 })),
    ],
    friendIndex: 1,
    baseBond: 100,
    costCap: 15,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.baseCost, 10);
  assert.equal(result.finalCost, 15);
  assert.ok(result.assignments.some((assignment) => assignment.index === 1 && assignment.countsCost === false));
});
