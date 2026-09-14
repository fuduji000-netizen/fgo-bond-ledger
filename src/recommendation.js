import { calculateBattleGain, calculateFormationSlotCost, getFormationBondBonus, numberOr } from "./calculator.js";
import { matchesCondition, parseBondEffect } from "./data-source.js";

const MAX_SEARCH_NODES = 3000000;

const zeroVector = (length) => Array.from({ length }, () => ({ percent: 0, flat: 0 }));
const addVectors = (left, right) => left.map((value, index) => ({
  percent: numberOr(value?.percent) + numberOr(right[index]?.percent),
  flat: numberOr(value?.flat) + numberOr(right[index]?.flat),
}));

function sameVector(left, right) {
  return left.length === right.length && left.every((value, index) => (
    numberOr(value?.percent) === numberOr(right[index]?.percent)
    && numberOr(value?.flat) === numberOr(right[index]?.flat)
  ));
}

function sourceContribution(ce, source, targets) {
  const effect = parseBondEffect(ce, true, { isSupport: source.owner === "friend" });
  if (!effect.parsed) return zeroVector(targets.length);

  return targets.map((target) => {
    if (!matchesCondition(target.profile, effect.condition)) return { percent: 0, flat: 0 };
    if (effect.target === "self" && target.index !== source.index) return { percent: 0, flat: 0 };
    return { percent: numberOr(effect.percent), flat: numberOr(effect.flat) };
  });
}

function createSources({ slots, friendIndex, grandOwnIndex, friendGrandServant }) {
  const ownSources = [];
  const friendSources = [];
  const ownGrand = Number.isInteger(grandOwnIndex) && grandOwnIndex !== friendIndex && slots[grandOwnIndex]?.profile
    ? grandOwnIndex
    : -1;
  const friendGrand = Boolean(friendGrandServant && slots[friendIndex]?.profile);

  // 每名从者（包括冠位从者）都有一张常规礼装格。只有本方的常规格占 Cost。
  slots.forEach((slot, index) => {
    if (index === friendIndex || !slot.profile) return;
    ownSources.push({
      key: `regular:${index}`,
      owner: "own",
      index,
      kind: "regular",
      extraIndex: null,
      countsCost: true,
      label: `位置 ${index + 1} 常规礼装`,
    });
  });

  // 冠位从者在常规礼装外再有一张冠位专用羁绊礼装格；该格不占 Cost。
  if (ownGrand >= 0) {
    ownSources.push(...[0].map((extraIndex) => ({
      key: `grand:${ownGrand}:${extraIndex}`,
      owner: "own",
      index: ownGrand,
      kind: "grand",
      extraIndex,
      countsCost: false,
      label: `位置 ${ownGrand + 1} 冠位羁绊礼装 ${extraIndex + 1}`,
    })));
  }

  if (slots[friendIndex]?.profile) {
    friendSources.push({
      key: `regular:${friendIndex}`,
      owner: "friend",
      index: friendIndex,
      kind: "regular",
      extraIndex: null,
      countsCost: false,
      label: "好友位常规礼装",
    });
  }

  if (friendGrand) {
    friendSources.push(...[0].map((extraIndex) => ({
      key: `grand:${friendIndex}:${extraIndex}`,
      owner: "friend",
      index: friendIndex,
      kind: "grand",
      extraIndex,
      countsCost: false,
      label: `好友位冠位羁绊礼装 ${extraIndex + 1}`,
    })));
  }

  return [...ownSources, ...friendSources];
}

function calculateBaseCost(slots, friendIndex) {
  return slots.reduce((total, slot, index) => {
    if (!slot.profile) return total;
    return total + calculateFormationSlotCost({
      servantCost: slot.profile.cost,
      isFriend: index === friendIndex,
    });
  }, 0);
}

function buildSymmetryKeys(sources, candidates) {
  return sources.map((source, sourceIndex) => {
    const peers = sources
      .map((candidateSource, index) => ({ candidateSource, index }))
      .filter(({ candidateSource }) => candidateSource.owner === source.owner
        && candidateSource.countsCost === source.countsCost);
    if (peers.length < 2) return "";

    const interchangeable = peers.every(({ index }) => candidates.every((candidate) => (
      sameVector(candidate.contributions[sourceIndex], candidate.contributions[index])
    )));
    return interchangeable ? `${source.owner}:${source.countsCost}` : "";
  });
}

function buildStaticBonuses({ slots, targets, friendIndex, partyBonus }) {
  const guideCount = slots.reduce((count, slot, index) => (
    index !== friendIndex && Number(slot.level) >= 15 && slot.guideEnabled ? count + 1 : count
  ), 0);
  const hasFriendServant = Boolean(slots[friendIndex]?.profile);
  return targets.map(({ slot, index }) => {
    const formation = getFormationBondBonus({ index, friendIndex, hasFriendServant });
    return {
      other: numberOr(partyBonus) + guideCount * 25 + numberOr(slot.eventBonus),
      formation: formation.party + formation.personal,
    };
  });
}

/**
 * 在当前编队、Cost 与加成上限下搜索总羁绊最高的概念礼装分配。
 * 同一张礼装在自方与好友方可各视为一张，但同一方不会重复装备同一张。
 */
export function recommendBondCraftEssences({
  ceList = [],
  slots = [],
  friendIndex = 0,
  targetIndices = [],
  grandOwnIndex = -1,
  friendGrandServant = false,
  baseBond = 0,
  partyBonus = 0,
  bonusCap = 500,
  teaPot = false,
  costCap = 0,
  ownedCeIds,
} = {}) {
  const normalizedSlots = slots.map((slot) => ({ ...slot, profile: slot?.profile || null }));
  const normalizedFriendIndex = Math.min(Math.max(Math.floor(numberOr(friendIndex)), 0), Math.max(0, normalizedSlots.length - 1));
  const explicitTargets = new Set((Array.isArray(targetIndices) ? targetIndices : [])
    .map((index) => Math.floor(numberOr(index, -1)))
    .filter((index) => index >= 0 && index < normalizedSlots.length && index !== normalizedFriendIndex));
  const targets = normalizedSlots
    .map((slot, index) => ({ slot, index, profile: slot.profile }))
    .filter(({ index, profile }) => index !== normalizedFriendIndex && profile && (!explicitTargets.size || explicitTargets.has(index)));
  const sources = createSources({
    slots: normalizedSlots,
    friendIndex: normalizedFriendIndex,
    grandOwnIndex,
    friendGrandServant,
  });
  const baseCost = calculateBaseCost(normalizedSlots, normalizedFriendIndex);
  const maximumCost = Math.max(0, numberOr(costCap));
  // 未提供库存时保持旧行为（默认全部持有）；传入空数组则表示本方一张也没有。
  const ownedOwnCeIds = Array.isArray(ownedCeIds)
    ? new Set(ownedCeIds.map((id) => String(id)))
    : null;
  const staticBonuses = buildStaticBonuses({
    slots: normalizedSlots,
    targets,
    friendIndex: normalizedFriendIndex,
    partyBonus,
  });
  const scoreFor = (bonusVector) => targets.reduce((sum, target, index) => (
    sum + calculateBattleGain({
      baseBond,
      percentBonus: staticBonuses[index].other + numberOr(bonusVector[index]?.percent),
      formationBonus: staticBonuses[index].formation,
      flatBonus: numberOr(bonusVector[index]?.flat),
      bonusCap,
      teaPot,
    }).gain
  ), 0);

  if (!targets.length) {
    return {
      status: "no-target",
      message: "请先在非好友位置选择至少一名从者",
      assignments: [],
      totalGain: 0,
      perSlot: [],
      baseCost,
      finalCost: baseCost,
      costCap: maximumCost,
      isExact: true,
      nodesVisited: 0,
      targetIndices: [],
    };
  }

  if (baseCost > maximumCost) {
    return {
      status: "over-cost",
      message: `从者 Cost ${baseCost} 已超过上限 ${maximumCost}，无法生成可用方案`,
      assignments: [],
      totalGain: 0,
      perSlot: [],
      baseCost,
      finalCost: baseCost,
      costCap: maximumCost,
      isExact: true,
      nodesVisited: 0,
      targetIndices: targets.map((target) => target.index),
    };
  }

  const candidates = ceList
    .map((ce) => ({
      ce,
      contributions: sources.map((source) => sourceContribution(ce, source, targets)),
    }))
    .filter((candidate) => candidate.contributions.some((vector) => vector.some((value) => value.percent > 0 || value.flat > 0)))
    .sort((left, right) => {
      const base = Math.max(0, numberOr(baseBond));
      const rightTotal = right.contributions.flat().reduce((sum, value) => sum + value.percent * base / 100 + value.flat, 0);
      const leftTotal = left.contributions.flat().reduce((sum, value) => sum + value.percent * base / 100 + value.flat, 0);
      return rightTotal - leftTotal || String(left.ce.name).localeCompare(String(right.ce.name), "zh-Hans-CN");
    });
  const symmetryKeys = buildSymmetryKeys(sources, candidates);
  const sourceMaximums = sources.map((source, sourceIndex) => targets.map((target, targetIndex) => ({
    percent: candidates.reduce((maximum, candidate) => (
      Math.max(maximum, numberOr(candidate.contributions[sourceIndex][targetIndex]?.percent))
    ), 0),
    flat: candidates.reduce((maximum, candidate) => (
      Math.max(maximum, numberOr(candidate.contributions[sourceIndex][targetIndex]?.flat))
    ), 0),
  })));
  const suffixMaximums = Array.from({ length: sources.length + 1 }, () => zeroVector(targets.length));
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    suffixMaximums[index] = addVectors(sourceMaximums[index], suffixMaximums[index + 1]);
  }
  const initialBonus = zeroVector(targets.length);
  const initialScore = scoreFor(initialBonus);
  const usedOwn = new Set();
  const usedFriend = new Set();
  const assignments = Array.from({ length: sources.length }, () => null);

  function canEquip(candidate, source, currentCost) {
    if (source.owner === "own" && ownedOwnCeIds && !ownedOwnCeIds.has(String(candidate.ce.id))) return false;
    const used = source.owner === "friend" ? usedFriend : usedOwn;
    if (used.has(String(candidate.ce.id))) return false;
    const nextCost = currentCost + (source.countsCost ? Math.max(0, numberOr(candidate.ce.cost)) : 0);
    return !source.countsCost || nextCost <= maximumCost;
  }

  function buildGreedySeed() {
    let bonus = initialBonus;
    let currentCost = baseCost;
    const selectedOwn = new Set();
    const selectedFriend = new Set();
    const selected = Array.from({ length: sources.length }, () => null);

    sources.forEach((source, sourceIndex) => {
      const used = source.owner === "friend" ? selectedFriend : selectedOwn;
      let bestCandidate = null;
      let bestBonus = bonus;
      let bestScore = scoreFor(bonus);
      candidates.forEach((candidate) => {
        if (source.owner === "own" && ownedOwnCeIds && !ownedOwnCeIds.has(String(candidate.ce.id))) return;
        if (used.has(String(candidate.ce.id))) return;
        const candidateCost = currentCost + (source.countsCost ? Math.max(0, numberOr(candidate.ce.cost)) : 0);
        if (source.countsCost && candidateCost > maximumCost) return;
        const nextBonus = addVectors(bonus, candidate.contributions[sourceIndex]);
        const nextScore = scoreFor(nextBonus);
        if (nextScore > bestScore) {
          bestCandidate = candidate;
          bestBonus = nextBonus;
          bestScore = nextScore;
        }
      });
      if (!bestCandidate) return;
      selected[sourceIndex] = bestCandidate;
      used.add(String(bestCandidate.ce.id));
      currentCost += source.countsCost ? Math.max(0, numberOr(bestCandidate.ce.cost)) : 0;
      bonus = bestBonus;
    });

    return { selected, bonus, cost: currentCost, score: scoreFor(bonus) };
  }

  const greedy = buildGreedySeed();
  let bestScore = Math.max(initialScore, greedy.score);
  let bestCost = greedy.score >= initialScore ? greedy.cost : baseCost;
  let bestBonus = greedy.score >= initialScore ? greedy.bonus : initialBonus;
  let bestAssignments = greedy.score >= initialScore ? greedy.selected : [...assignments];
  let nodesVisited = 0;
  let searchStopped = false;

  function search(sourceIndex, bonus, currentCost, minimumCandidateIndex) {
    if (searchStopped) return;
    nodesVisited += 1;
    if (nodesVisited > MAX_SEARCH_NODES) {
      searchStopped = true;
      return;
    }

    const looseUpperBound = scoreFor(addVectors(bonus, suffixMaximums[sourceIndex]));
    if (looseUpperBound <= bestScore) return;
    if (sourceIndex >= sources.length) {
      const score = scoreFor(bonus);
      if (score > bestScore || (score === bestScore && currentCost < bestCost)) {
        bestScore = score;
        bestCost = currentCost;
        bestBonus = bonus;
        bestAssignments = [...assignments];
      }
      return;
    }

    const source = sources[sourceIndex];
    const sameGroup = sourceIndex > 0 && symmetryKeys[sourceIndex] && symmetryKeys[sourceIndex] === symmetryKeys[sourceIndex - 1];
    const start = sameGroup ? minimumCandidateIndex : 0;
    const choices = [];

    for (let candidateIndex = start; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
      if (!canEquip(candidate, source, currentCost)) continue;
      const nextBonus = addVectors(bonus, candidate.contributions[sourceIndex]);
      choices.push({ candidate, candidateIndex, nextBonus, score: scoreFor(nextBonus) });
    }

    choices.sort((left, right) => right.score - left.score || left.candidateIndex - right.candidateIndex);
    const used = source.owner === "friend" ? usedFriend : usedOwn;
    for (const choice of choices) {
      assignments[sourceIndex] = choice.candidate;
      used.add(String(choice.candidate.ce.id));
      const nextCost = currentCost + (source.countsCost ? Math.max(0, numberOr(choice.candidate.ce.cost)) : 0);
      const nextSameGroup = sourceIndex + 1 < sources.length
        && symmetryKeys[sourceIndex + 1]
        && symmetryKeys[sourceIndex + 1] === symmetryKeys[sourceIndex];
      search(sourceIndex + 1, choice.nextBonus, nextCost, nextSameGroup ? choice.candidateIndex + 1 : 0);
      used.delete(String(choice.candidate.ce.id));
      assignments[sourceIndex] = null;
      if (searchStopped) return;
    }

    const nextSameGroup = sourceIndex + 1 < sources.length
      && symmetryKeys[sourceIndex + 1]
      && symmetryKeys[sourceIndex + 1] === symmetryKeys[sourceIndex];
    search(sourceIndex + 1, bonus, currentCost, nextSameGroup ? candidates.length : 0);
  }

  if (baseCost <= maximumCost || sources.some((source) => !source.countsCost)) {
    search(0, initialBonus, baseCost, 0);
  }

  const perSlot = targets.map((target, index) => {
    const otherBonus = staticBonuses[index].other + numberOr(bestBonus[index]?.percent);
    const formationBonus = staticBonuses[index].formation;
    const bonus = otherBonus + formationBonus;
    const flatBonus = numberOr(bestBonus[index]?.flat);
    const battle = calculateBattleGain({ baseBond, percentBonus: otherBonus, formationBonus, flatBonus, bonusCap, teaPot });
    return {
      index: target.index,
      name: target.profile.name || `位置 ${target.index + 1}`,
      bonus,
      otherBonus,
      formationBonus,
      flatBonus,
      baseGain: battle.baseGain,
      bonusGain: battle.bonusGain,
      gain: battle.gain,
      capped: battle.capped,
    };
  });

  return {
    status: candidates.length ? "ok" : "no-candidate",
    message: candidates.length ? "" : "当前阵容没有可生效的已收录羁绊加成礼装",
    assignments: sources.map((source, index) => ({
      ...source,
      ceId: bestAssignments[index]?.ce?.id || "",
      ceName: bestAssignments[index]?.ce?.name || "",
      ceCost: Math.max(0, numberOr(bestAssignments[index]?.ce?.cost)),
    })).filter((assignment) => assignment.ceId),
    totalGain: bestScore,
    perSlot,
    baseCost,
    finalCost: bestCost,
    costCap: maximumCost,
    isExact: !searchStopped,
    nodesVisited,
    targetIndices: targets.map((target) => target.index),
  };
}
