export const MAX_BOND_LEVEL = 16;
export const POST_TEN_REQUIREMENTS = [1090000, 1230000, 1360000, 1500000, 1640000, 5000000];

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

export function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeTeaPotCount(value, fallback = 0) {
  return Math.max(0, Math.floor(numberOr(value, fallback)));
}

function getTeaPotCount(context = {}) {
  if (context?.teaPotCount !== undefined && context?.teaPotCount !== null) {
    return normalizeTeaPotCount(context.teaPotCount);
  }
  // 兼容旧调用方的布尔开关：true 代表本次计算中的所有场次均使用茶壶。
  return context?.teaPot ? Number.MAX_SAFE_INTEGER : 0;
}

/**
 * 游戏编队的固定牵绊加成：前排非好友从者获得个人 +20%，
 * 已编入的好友从者处于前排时，全队获得 +4%。
 */
export function getFormationBondBonus({ index, friendIndex, hasFriendServant = false } = {}) {
  const slotIndex = Math.floor(numberOr(index, -1));
  const supportIndex = Math.floor(numberOr(friendIndex, -1));
  const isFrontline = slotIndex >= 0 && slotIndex < 3;
  const friendIsFrontline = Boolean(hasFriendServant) && supportIndex >= 0 && supportIndex < 3;

  return {
    personal: isFrontline && slotIndex !== supportIndex ? 20 : 0,
    party: friendIsFrontline ? 4 : 0,
  };
}

/**
 * 编队 Cost 规则：好友位永不占用 Cost。无论从者是否冠位，其一张常规礼装
 * 都占用 Cost；冠位专用礼装不传入 regularCeCost，因此不会计入。
 */
export function calculateFormationSlotCost({
  servantCost = 0,
  regularCeCost = 0,
  isFriend = false,
} = {}) {
  if (isFriend) return 0;
  const servant = Math.max(0, numberOr(servantCost));
  const regularCe = Math.max(0, numberOr(regularCeCost));
  return servant + regularCe;
}

export function getRequirement(profile, level) {
  if (level < 0 || level >= MAX_BOND_LEVEL) return 0;
  if (level < 10) return Math.max(0, numberOr(profile?.bondPoints?.[level]));
  return POST_TEN_REQUIREMENTS[level - 10];
}

export function progressFromRemaining(profile, level, remaining) {
  const requirement = getRequirement(profile, level);
  if (requirement <= 0) return 0;
  const safeRemaining = clamp(Math.floor(numberOr(remaining, requirement)), 1, requirement);
  return requirement - safeRemaining;
}

/**
 * Lv.10 之前的牵绊可以连续升级，返回从当前进度累计到 Lv.10 所需的点数。
 * Lv.10 及以后不应调用此目标，因为那些阶段需要用户在游戏内逐级解锁。
 */
export function getRemainingToLevelTen(profile, level, progress = 0) {
  const currentLevel = clamp(Math.floor(numberOr(level)), 0, MAX_BOND_LEVEL);
  if (currentLevel >= 10) return 0;
  const currentRequirement = getRequirement(profile, currentLevel);
  const currentProgress = clamp(
    Math.floor(numberOr(progress)),
    0,
    Math.max(0, currentRequirement - 1),
  );
  let remaining = Math.max(0, currentRequirement - currentProgress);
  for (let stage = currentLevel + 1; stage < 10; stage += 1) {
    remaining += getRequirement(profile, stage);
  }
  return remaining;
}

export function normalizeUnlockedLevel(value, fallback = 10) {
  return clamp(Math.floor(numberOr(value, fallback)), 10, MAX_BOND_LEVEL);
}

export function getRewardForLevel(level, star = 5) {
  const rarity = clamp(Math.floor(numberOr(star, 5)), 0, 5);
  const coins = (quantity) => ({ name: "从者硬币", quantity });
  const quartz = (quantity) => ({ name: "圣晶石", quantity });
  const fruit = () => ({ name: "黄金果实", quantity: 1 });

  if (level >= 1 && level <= 5) return [coins(5)];

  if (level >= 6 && level <= 9) {
    const rewards = [];
    if (rarity <= 1 && level <= 8) rewards.push(fruit());
    else if (rarity === 2 && level <= 7) rewards.push(fruit());
    else rewards.push(quartz(Math.max(1, rarity)));
    rewards.push(coins(level === 6 ? 5 : 20));
    return rewards;
  }

  if (level === 10) return [{ name: "专属羁绊礼装", quantity: 1 }, coins(40)];
  if (level >= 11 && level <= 14) return [quartz(30), coins(level === 11 ? 50 : 60)];
  if (level === 15) return [quartz(30), coins(60), { name: "梦火的引导", quantity: 1 }];
  if (level === 16) return [quartz(30), coins(60)];
  return [];
}

export function getCeilingMessage(level, unlockedLevel = 10) {
  const currentLevel = clamp(Math.floor(numberOr(level)), 0, MAX_BOND_LEVEL);
  const cap = normalizeUnlockedLevel(unlockedLevel);
  if (currentLevel >= MAX_BOND_LEVEL) return "已达到 Lv.16 满绊";
  if (currentLevel >= 10 && currentLevel >= cap) {
    return `已达到 Lv.${cap} 上限；请在游戏内开启后，将牵绊等级手动改为 Lv.${cap + 1}`;
  }
  return null;
}

/**
 * 计算单场牵绊。
 *
 * 游戏会把前三位与好友前排带来的编队加成单独结算，再结算礼装、活动
 * 等其他百分比加成；两次百分比结算之间都要向下取整。`percentBonus`
 * 保留为其他百分比加成，`formationBonus` 则是独立的编队百分比加成。
 */
export function calculateBattleGain({
  baseBond,
  percentBonus,
  otherPercentBonus,
  formationBonus,
  formationPercentBonus,
  formationPersonalBonus,
  formationPartyBonus,
  flatBonus = 0,
  bonusCap = 500,
  teaPot = false,
}) {
  const safeBaseBond = Math.max(0, Math.floor(numberOr(baseBond)));
  const requestedBonus = Math.max(0, numberOr(percentBonus ?? otherPercentBonus));
  const requestedFormationBonus = Math.max(0, numberOr(
    formationBonus ?? formationPercentBonus,
    numberOr(formationPersonalBonus) + numberOr(formationPartyBonus),
  ));
  const safeFlatBonus = Math.max(0, Math.floor(numberOr(flatBonus)));
  const safeCap = Math.max(0, numberOr(bonusCap, 500));
  const appliedBonus = Math.min(requestedBonus, safeCap);
  const formationStage = Math.floor(safeBaseBond * (100 + requestedFormationBonus) / 100);
  // 英灵肖像的固定 +50 在两段百分比加成结算后加入，再由占星茶壶翻倍。
  const otherPercentStage = Math.floor(formationStage * (100 + appliedBonus) / 100);
  const beforeTeaPot = otherPercentStage + safeFlatBonus;
  const gain = beforeTeaPot * (teaPot ? 2 : 1);
  const formationGain = formationStage - safeBaseBond;
  const otherPercentGain = otherPercentStage - formationStage;
  const flatGain = safeFlatBonus;

  return {
    gain,
    baseGain: safeBaseBond,
    formationGain,
    otherPercentGain,
    flatGain,
    bonusGain: Math.max(0, gain - safeBaseBond),
    formationStage,
    otherPercentStage,
    requestedBonus,
    appliedBonus,
    requestedFormationBonus,
    appliedFormationBonus: requestedFormationBonus,
    flatBonus: safeFlatBonus,
    capped: requestedBonus > appliedBonus,
    beforeTeaPot,
  };
}

/**
 * 茶壶总是在本次记录的前若干场优先使用。返回到达目标所需的总场数，
 * 以及其中实际会消耗茶壶和普通结算的场数。
 */
export function calculateBattlePlan({
  remaining,
  normalGain,
  teaPotGain,
  teaPotCount = 0,
} = {}) {
  const points = Math.max(0, Math.floor(numberOr(remaining)));
  const normal = Math.max(0, Math.floor(numberOr(normalGain)));
  const teaPot = Math.max(0, Math.floor(numberOr(teaPotGain)));
  const availableTeaPots = normalizeTeaPotCount(teaPotCount);

  if (points === 0) {
    return {
      battles: 0,
      teaPotBattles: 0,
      normalBattles: 0,
      teaPotPoints: 0,
      remainingAfterTeaPot: 0,
    };
  }

  let teaPotBattles = 0;
  let remainingAfterTeaPot = points;
  if (availableTeaPots > 0 && teaPot > normal && teaPot > 0) {
    teaPotBattles = Math.min(availableTeaPots, Math.ceil(points / teaPot));
    remainingAfterTeaPot = Math.max(0, points - teaPotBattles * teaPot);
  }

  if (remainingAfterTeaPot > 0 && normal <= 0) return null;
  const normalBattles = remainingAfterTeaPot > 0 ? Math.ceil(remainingAfterTeaPot / normal) : 0;
  return {
    battles: teaPotBattles + normalBattles,
    teaPotBattles,
    normalBattles,
    teaPotPoints: teaPotBattles * teaPot,
    remainingAfterTeaPot,
  };
}

export function calculateSlot(slot, teamContext) {
  const level = clamp(Math.floor(numberOr(slot.level)), 0, MAX_BOND_LEVEL);
  const profile = slot.profile || {};
  const requirement = getRequirement(profile, level);
  const unlockedLevel = normalizeUnlockedLevel(slot.unlockedLevel);
  const globalBonus = numberOr(teamContext.globalBonus) + numberOr(teamContext.otherGlobalBonus);
  const personalBonus = numberOr(teamContext.personalBonus) + numberOr(teamContext.otherPersonalBonus) + numberOr(slot.personalBonus);
  const formationBonus = numberOr(
    teamContext.formationBonus ?? teamContext.formationPercentBonus,
    numberOr(teamContext.formationPersonal) + numberOr(teamContext.formationParty),
  );
  const battleInput = {
    baseBond: teamContext.baseBond,
    percentBonus: globalBonus + personalBonus,
    formationBonus,
    flatBonus: numberOr(teamContext.flatBonus),
    bonusCap: teamContext.bonusCap,
  };
  const normalBattle = calculateBattleGain({ ...battleInput, teaPot: false });
  const teaPotBattle = calculateBattleGain({ ...battleInput, teaPot: true });
  const teaPotCount = getTeaPotCount(teamContext);
  const battle = teaPotCount > 0 ? teaPotBattle : normalBattle;
  const nextLevel = level < MAX_BOND_LEVEL ? level + 1 : null;
  const nextReward = nextLevel ? getRewardForLevel(nextLevel, profile.star) : [];
  // Lv.10 之后填满阶段时保留在当前等级，等待用户在游戏内开启后手动提高
  // 等级。该状态允许 progress 正好等于当前阶段需求，以便显示升级剩余为 0。
  const awaitingUnlock = level >= 10 && slot.awaitingUnlock === true;
  const progressLimit = awaitingUnlock ? Math.max(0, requirement) : Math.max(0, requirement - 1);
  const progress = clamp(Math.floor(numberOr(slot.progress)), 0, progressLimit);
  const atStageCap = awaitingUnlock && requirement > 0 && progress >= requirement;
  const ceilingMessage = level >= MAX_BOND_LEVEL || atStageCap
    ? getCeilingMessage(level, level)
    : null;
  const remaining = Math.max(0, requirement - progress);
  const nextStagePlan = calculateBattlePlan({
    remaining,
    normalGain: normalBattle.gain,
    teaPotGain: teaPotBattle.gain,
    teaPotCount,
  });
  const targetLevel = level < 10 ? 10 : nextLevel;
  const targetRemaining = level < 10 ? getRemainingToLevelTen(profile, level, progress) : remaining;
  const battlePlan = targetLevel !== null
    ? calculateBattlePlan({
      remaining: targetRemaining,
      normalGain: normalBattle.gain,
      teaPotGain: teaPotBattle.gain,
      teaPotCount,
    })
    : null;

  if (ceilingMessage || requirement <= 0) {
    return {
      level,
      unlockedLevel,
      awaitingUnlock,
      requirement,
      progress,
      remaining,
      battlesNeeded: null,
      nextStageBattles: null,
      battlePlan: null,
      nextStagePlan: null,
      targetLevel,
      targetRemaining,
      nextLevel,
      nextReward,
      battle,
      normalBattle,
      teaPotBattle,
      teaPotCount,
      ceilingMessage,
    };
  }

  return {
    level,
    unlockedLevel,
    awaitingUnlock,
    requirement,
    progress,
    remaining,
    battlesNeeded: battlePlan?.battles ?? null,
    nextStageBattles: nextStagePlan?.battles ?? null,
    battlePlan,
    nextStagePlan,
    targetLevel,
    targetRemaining,
    nextLevel,
    nextReward,
    battle,
    normalBattle,
    teaPotBattle,
    teaPotCount,
    ceilingMessage: null,
  };
}

export function applyBattles(slot, teamContext, battleCount) {
  const count = Math.max(0, Math.floor(numberOr(battleCount)));
  const initial = calculateSlot(slot, teamContext);
  const result = {
    slot: { ...slot },
    battlesApplied: 0,
    battlesSkipped: count,
    rewards: [],
    stoppedReason: initial.ceilingMessage || null,
    gainPerBattle: initial.battle.gain,
    normalGainPerBattle: initial.normalBattle.gain,
    teaPotGainPerBattle: initial.teaPotBattle.gain,
    teaPotBattlesApplied: 0,
  };
  result.slot.awaitingUnlock = initial.awaitingUnlock;

  if (count === 0 || initial.ceilingMessage || (initial.normalBattle.gain <= 0 && initial.teaPotBattle.gain <= 0)) {
    if (!result.stoppedReason && initial.normalBattle.gain <= 0 && initial.teaPotBattle.gain <= 0) result.stoppedReason = "单场牵绊为 0，未记入战斗";
    return result;
  }

  const unlockedLevel = initial.unlockedLevel;
  let remainingBattles = count;
  let level = initial.level;
  let progress = initial.progress;
  let teaPotBattlesRemaining = Math.min(count, getTeaPotCount(teamContext));

  let overflowPoints = 0;
  while ((remainingBattles > 0 || overflowPoints > 0) && level < MAX_BOND_LEVEL) {
    const requirement = getRequirement(slot.profile, level);
    const pointsNeeded = Math.max(0, requirement - progress);
    // 阶段刚好填满时先升级；如果还有溢出点数，继续在同一场结算。
    if (pointsNeeded === 0) {
      if (level >= 10) {
        progress = requirement;
        result.slot.awaitingUnlock = true;
        result.stoppedReason = getCeilingMessage(level, level);
        break;
      }
      level += 1;
      progress = 0;
      result.rewards.push({ level, rewards: getRewardForLevel(level, slot.profile?.star) });
      continue;
    }

    // 溢出点数来自已经记入的战斗，不应再次消耗战斗次数。
    if (overflowPoints > 0) {
      const appliedPoints = overflowPoints;
      overflowPoints = 0;
      if (appliedPoints < pointsNeeded) {
        progress += appliedPoints;
        continue;
      }
      overflowPoints = appliedPoints - pointsNeeded;
      if (level >= 10) {
        progress = requirement;
        result.slot.awaitingUnlock = true;
        result.stoppedReason = getCeilingMessage(level, level);
        break;
      }
      level += 1;
      progress = 0;
      result.rewards.push({ level, rewards: getRewardForLevel(level, slot.profile?.star) });
      continue;
    }

    const usesTeaPot = teaPotBattlesRemaining > 0;
    const gain = usesTeaPot ? initial.teaPotBattle.gain : initial.normalBattle.gain;
    const phaseBattles = usesTeaPot ? teaPotBattlesRemaining : remainingBattles;

    if (gain <= 0) {
      if (usesTeaPot) {
        teaPotBattlesRemaining = 0;
        continue;
      }
      result.stoppedReason = "单场牵绊为 0，未记入剩余战斗";
      break;
    }

    const neededBattles = Math.ceil(pointsNeeded / gain);
    const appliedBattles = Math.min(phaseBattles, neededBattles);
    const appliedPoints = appliedBattles * gain;

    result.battlesApplied += appliedBattles;
    remainingBattles -= appliedBattles;
    if (usesTeaPot) {
      teaPotBattlesRemaining -= appliedBattles;
      result.teaPotBattlesApplied += appliedBattles;
    }

    if (appliedBattles < neededBattles) {
      progress += appliedPoints;
      if (usesTeaPot) continue;
      break;
    }

    // 保留本次批量记入超过当前阶段阈值的点数，供后续阶段继续结算。
    overflowPoints = appliedPoints - pointsNeeded;
    if (level >= 10) {
      progress = requirement;
      result.slot.awaitingUnlock = true;
      result.stoppedReason = getCeilingMessage(level, level);
      break;
    }

    level += 1;
    progress = 0;
    result.rewards.push({ level, rewards: getRewardForLevel(level, slot.profile?.star) });
  }

  result.slot.level = level;
  result.slot.progress = progress;
  result.slot.unlockedLevel = unlockedLevel;
  result.battlesSkipped = remainingBattles;
  return result;
}
