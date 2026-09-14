import { applyBattles, calculateFormationSlotCost, calculateSlot, getFormationBondBonus, getRequirement, normalizeTeaPotCount, normalizeUnlockedLevel, numberOr, progressFromRemaining } from "./calculator.js";
import { recommendBondCraftEssences } from "./recommendation.js";
import { BBC_ASSIST_MODES, BBC_MASTER_EQUIPS, BbchannelExportError, createBbchannelTeamConfig, getDefaultBbchannelAssistMode, getDefaultBbchannelFriendRequirements, normalizeBbchannelMasterEquip } from "./bbchannel.js";
import { mergeCatalog } from "./catalog.js";
import {
  CLASS_NAMES,
  fetchAtlasBondPoints,
  fetchLiveCatalog,
  fetchWikiText,
  getGrandBattleAllowedClasses,
  matchesCondition,
  normalizeConditionRequirement,
  normalizeText,
  parseBondEffect,
  parseServantProfile,
} from "./data-source.js";

const STATE_KEY = "fgo-bond-ledger.state.v1";
const LIVE_CATALOG_KEY = "fgo-bond-ledger.live-catalog.v1";
const LINEUPS_KEY = "fgo-bond-ledger.lineups.v1";
const UNOWNED_CES_KEY = "fgo-bond-ledger.unowned-ce-ids.v1";
const GRAND_CLASSES = ["Saber", "Archer", "Lancer", "Rider", "Caster", "Assassin", "Berserker", "Extra"];
const GRAND_CE_SLOTS = 1;
const POSITION_LABELS = ["第一", "第二", "第三", "第四", "第五", "第六"];

const byId = (items = []) => new Map(items.map((item) => [String(item.id), item]));
const clone = (value) => JSON.parse(JSON.stringify(value));

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "") || fallback;
  } catch {
    return fallback;
  }
}

function defaultSlot(position) {
  return {
    position,
    servantId: "",
    level: 0,
    progress: 0,
    unlockedLevel: 10,
    awaitingUnlock: false,
    guideEnabled: false,
    ceId: "",
    ceMlb: true,
    hasCostume: false,
    grandCeIds: Array.from({ length: GRAND_CE_SLOTS }, () => ""),
    grandCeMlbs: Array.from({ length: GRAND_CE_SLOTS }, () => true),
    recommendationTarget: false,
    eventBonus: 0,
  };
}

function defaultState() {
  return {
    mode: "normal",
    normalBaseBond: 815,
    grandClass: "Saber",
    grandBattleId: "",
    grandOwnPosition: 0,
    friendGrandServant: false,
    friendPosition: 3,
    masterEquip: 0,
    costCap: 114,
    teaPotEnabled: false,
    teaPotCount: 0,
    partyBonus: 0,
    bonusCap: 500,
    battleCount: 1,
    slots: Array.from({ length: 6 }, (_, index) => defaultSlot(index + 1)),
    history: [],
    logs: [],
  };
}

function normalizeState(candidate) {
  const fallback = defaultState();
  const source = candidate && typeof candidate === "object" ? candidate : {};
  // 旧版用布尔值表示是否使用茶壶。读取旧存档时将其迁移为一只库存，
  // 但不再把旧字段继续写回新的状态。
  const {
    teaPot: legacyTeaPot,
    countFriendCost: _legacyCountFriendCost,
    master_equip: legacyMasterEquip,
    ...stateSource
  } = source;
  const slots = fallback.slots.map((slot, index) => {
    const saved = stateSource.slots?.[index] || {};
    const legacyDreamfires = Math.min(Math.max(Math.floor(numberOr(saved.dreamfiresUsed)), 0), 5);
    const legacyUnlockedLevel = 10 + legacyDreamfires + (legacyDreamfires === 5 && saved.grandDreamfireUsed ? 1 : 0);
    let currentLevel = Math.min(Math.max(Math.floor(numberOr(saved.level)), 0), 16);
    let currentProgress = Math.max(0, Math.floor(numberOr(saved.progress)));
    const { dreamfiresUsed, grandDreamfireUsed, recommendationTarget, positionBonus, awaitingUnlock, ...savedSlot } = saved;
    const persistedUnlockedLevel = normalizeUnlockedLevel(Math.max(numberOr(saved.unlockedLevel, 10), legacyUnlockedLevel));
    // 旧版在 Lv.10 之后填满阶段时会先显示下一等级、进度重置为 0。
    // 新版要求停留在已经填满的当前等级，因此仅迁移这种可识别的旧状态。
    let normalizedAwaitingUnlock = awaitingUnlock === true;
    if (normalizedAwaitingUnlock && currentProgress === 0 && currentLevel >= 10) {
      if (currentLevel === 10) {
        normalizedAwaitingUnlock = false;
      } else if (currentLevel < 16) {
        currentLevel -= 1;
        currentProgress = getRequirement(null, currentLevel);
      } else {
        // Lv.16 是最终满绊，不能把旧存档错误迁回 Lv.15。
        normalizedAwaitingUnlock = false;
      }
    }
    return {
      ...slot,
      ...savedSlot,
      position: index + 1,
      level: currentLevel,
      unlockedLevel: normalizeUnlockedLevel(Math.max(persistedUnlockedLevel, currentLevel)),
      // 旧存档没有明确等待标记时，按可继续录入处理。仅凭等级和进度无法
      // 判断是否已经使用梦火，推断会导致手动升等级后提示再次出现。
      awaitingUnlock: normalizedAwaitingUnlock,
      hasCostume: Boolean(saved.hasCostume),
      grandCeIds: Array.from({ length: GRAND_CE_SLOTS }, (_, extraIndex) => String(saved.grandCeIds?.[extraIndex] || "")),
      grandCeMlbs: Array.from({ length: GRAND_CE_SLOTS }, (_, extraIndex) => saved.grandCeMlbs?.[extraIndex] !== false),
      recommendationTarget: Boolean(recommendationTarget),
    };
  });
  const grandOwnPosition = Math.floor(Number(stateSource.grandOwnPosition));
  const teaPotCount = normalizeTeaPotCount(stateSource.teaPotCount, legacyTeaPot ? 1 : 0);
  // 明确保存过开关时以其为准；旧存档没有开关字段时，有库存即视为启用，
  // 避免升级后用户原本已填写的茶壶突然不再参与计算。
  const teaPotEnabled = typeof stateSource.teaPotEnabled === "boolean"
    ? stateSource.teaPotEnabled
    : legacyTeaPot === true || teaPotCount > 0;
  return {
    ...fallback,
    ...stateSource,
    masterEquip: normalizeBbchannelMasterEquip(stateSource.masterEquip ?? legacyMasterEquip, fallback.masterEquip),
    teaPotEnabled,
    teaPotCount,
    friendPosition: Math.min(Math.max(Number(stateSource.friendPosition) || fallback.friendPosition, 1), 6),
    grandOwnPosition: grandOwnPosition >= 1 && grandOwnPosition <= 6 ? grandOwnPosition : 0,
    friendGrandServant: Boolean(stateSource.friendGrandServant),
    slots,
    history: Array.isArray(stateSource.history) ? stateSource.history.slice(0, 8) : [],
    logs: Array.isArray(stateSource.logs) ? stateSource.logs.slice(0, 8) : [],
  };
}

let catalog = mergeCatalog(window.FGO_MOONCELL_SNAPSHOT, loadJson(LIVE_CATALOG_KEY, null));
let state = normalizeState(loadJson(STATE_KEY, null));
const savedUnownedCeIds = loadJson(UNOWNED_CES_KEY, []);
let unownedCeIds = new Set((Array.isArray(savedUnownedCeIds) ? savedUnownedCeIds : []).map((id) => String(id)));
let servantMap = byId(catalog.servants);
let ceMap = byId(catalog.bondCraftEssences);
let profileLoading = new Set();
let profileErrors = new Map();
let activeServantSlot = null;
let activeCeTarget = null;
let dataStatus = "";
let savedLineups = loadJson(LINEUPS_KEY, {});
let selectedLineupName = "";
let lineupNameDraft = "";
let recommendation = null;
let recommendationSignature = "";
let draggedSlotIndex = null;
let draggedFriendIndex = null;
let draggedCe = null;
let bbchannelExportOptionsResolver = null;
const elements = {
  normalSettings: document.querySelector("#normal-settings"),
  grandSettings: document.querySelector("#grand-settings"),
  lineupName: document.querySelector("#lineup-name"),
  savedLineups: document.querySelector("#saved-lineups"),
  normalBaseBond: document.querySelector("#normal-base-bond"),
  grandClass: document.querySelector("#grand-class"),
  grandBattle: document.querySelector("#grand-battle"),
  grandSource: document.querySelector("#grand-source"),
  masterEquip: document.querySelector("#master-equip"),
  masterEquipHint: document.querySelector("#master-equip-hint"),
  friendPosition: document.querySelector("#friend-position"),
  costCap: document.querySelector("#cost-cap"),
  teaPotEnabled: document.querySelector("#tea-pot-enabled"),
  teaPotCount: document.querySelector("#tea-pot-count"),
  partyBonus: document.querySelector("#party-bonus"),
  bonusCap: document.querySelector("#bonus-cap"),
  battleCount: document.querySelector("#battle-count"),
  partyGrid: document.querySelector("#party-grid"),
  costSummary: document.querySelector("#cost-summary"),
  costWarning: document.querySelector("#cost-warning"),
  battleSummary: document.querySelector("#battle-summary"),
  dataStatus: document.querySelector("#data-status"),
  sourceMeta: document.querySelector("#source-meta"),
  battleLog: document.querySelector("#battle-log"),
  recommendationPanel: document.querySelector("#recommendation-panel"),
  recommendationOutput: document.querySelector("#recommendation-output"),
  applyRecommendation: document.querySelector("#apply-recommendation"),
  servantModal: document.querySelector("#servant-modal"),
  servantSearch: document.querySelector("#servant-search"),
  servantClassFilter: document.querySelector("#servant-class-filter"),
  servantStarFilter: document.querySelector("#servant-star-filter"),
  servantList: document.querySelector("#servant-list"),
  servantCount: document.querySelector("#servant-count"),
  ceModal: document.querySelector("#ce-modal"),
  ceSearch: document.querySelector("#ce-search"),
  ceList: document.querySelector("#ce-list"),
  ceCount: document.querySelector("#ce-count"),
  openOwnedCes: document.querySelector("#open-owned-ces"),
  ownedCeModal: document.querySelector("#owned-ce-modal"),
  ownedCeSearch: document.querySelector("#owned-ce-search"),
  ownedCeList: document.querySelector("#owned-ce-list"),
  ownedCeCount: document.querySelector("#owned-ce-count"),
  checkUpdates: document.querySelector("#check-updates"),
  openBbchannel: document.querySelector("#open-bbchannel"),
  exportBbchannelTeam: document.querySelector("#export-bbchannel-team"),
  bbchannelAssistModeModal: document.querySelector("#bbchannel-assist-mode-modal"),
  bbchannelAssistMode: document.querySelector("#bbchannel-assist-mode"),
  bbchannelAssistModeHint: document.querySelector("#bbchannel-assist-mode-hint"),
  bbchannelNpLevel: document.querySelector("#bbchannel-np-level"),
  bbchannelServantLevel: document.querySelector("#bbchannel-servant-level"),
  bbchannelAssistModeConfirm: document.querySelector("#bbchannel-assist-mode-confirm"),
  bbchannelAssistModeCancel: document.querySelector("#bbchannel-assist-mode-cancel"),
  openEmulator: document.querySelector("#open-emulator"),
  openToolPaths: document.querySelector("#open-tool-paths"),
  updateModal: document.querySelector("#update-modal"),
  updateTitle: document.querySelector("#update-title"),
  updateMessage: document.querySelector("#update-message"),
  updatePrimary: document.querySelector("#update-primary"),
  updateLater: document.querySelector("#update-later"),
  updateSkip: document.querySelector("#update-skip"),
  toolPathsModal: document.querySelector("#tool-paths-modal"),
  bbchannelPath: document.querySelector("#bbchannel-path"),
  emulatorPath: document.querySelector("#emulator-path"),
};

function persistState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    dataStatus = "本地存储空间不足，当前修改未持久化";
  }
}

function persistLineups() {
  try {
    localStorage.setItem(LINEUPS_KEY, JSON.stringify(savedLineups));
  } catch {
    dataStatus = "编队档案未能写入本地存储";
  }
}

function persistUnownedCes() {
  try {
    localStorage.setItem(UNOWNED_CES_KEY, JSON.stringify([...unownedCeIds].sort()));
  } catch {
    dataStatus = "礼装持有清单未能写入本地存储";
  }
}

function refreshMaps() {
  servantMap = byId(catalog.servants);
  ceMap = byId(catalog.bondCraftEssences);
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(value) {
  return Math.max(0, Math.floor(numberOr(value))).toLocaleString("zh-CN");
}

function formatPercent(value) {
  return Math.max(0, numberOr(value)).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function formatBonusBadge(bonus) {
  const other = numberOr(bonus.otherTotal, numberOr(bonus.global) + numberOr(bonus.personal));
  const formation = numberOr(bonus.formationTotal, numberOr(bonus.formationPersonal) + numberOr(bonus.formationParty));
  const parts = [];
  if (other > 0) parts.push(`其他 +${formatPercent(other)}%`);
  if (formation > 0) parts.push(`编队 +${formatPercent(formation)}%`);
  if (numberOr(bonus.flatTotal) > 0) parts.push(`固定 +${formatNumber(bonus.flatTotal)} 点`);
  return parts.join(" · ") || "+0%";
}

function labelForClass(className) {
  if (className === "Extra") return "Extra";
  return CLASS_NAMES[className] || className || "未知职阶";
}

function getServant(slot) {
  return servantMap.get(String(slot.servantId)) || null;
}

function getProfile(slot) {
  const servant = getServant(slot);
  if (!servant) return null;
  return { ...servant, ...(catalog.profiles?.[String(servant.id)] || {}), hasCostume: Boolean(slot.hasCostume) };
}

function hasCompleteProfile(profile) {
  return Array.isArray(profile?.bondPoints) && profile.bondPoints.length === 10 && profile.bondPoints.every((point) => Number(point) > 0);
}

function getCe(slot) {
  return ceMap.get(String(slot.ceId)) || null;
}

function getGrandCe(slot, extraIndex) {
  return ceMap.get(String(slot.grandCeIds?.[extraIndex])) || null;
}

function getFriendIndex() {
  return Number(state.friendPosition) - 1;
}

function getCurrentGrandBattle() {
  return catalog.grandBattles.find((battle) => battle.id === state.grandBattleId) || null;
}

function getBaseBond() {
  return state.mode === "normal"
    ? Math.max(0, numberOr(state.normalBaseBond))
    : Math.max(0, numberOr(getCurrentGrandBattle()?.baseBond));
}

function getGrandAllowedClasses() {
  return getGrandBattleAllowedClasses(getCurrentGrandBattle());
}

function grandRestrictionLabel() {
  const classes = getGrandAllowedClasses();
  return classes.length ? classes.map(labelForClass).join(" / ") : labelForClass(state.grandClass);
}

function isGrandCompatible(profile) {
  if (state.mode !== "grand" || !profile) return true;
  return getGrandAllowedClasses().includes(profile.className);
}

function isGrandServantSlot(index) {
  if (state.mode !== "grand") return false;
  return index === getFriendIndex()
    ? Boolean(state.friendGrandServant)
    : Number(state.grandOwnPosition) === index + 1;
}

function isCeOwned(ceId) {
  return Boolean(ceId) && !unownedCeIds.has(String(ceId));
}

// 礼装检索文本：名称、页面标题、别名与效果说明都参与匹配。
function ceSearchText(ce) {
  return `${ce.name} ${ce.title} ${(ce.aliases || []).join(" ")} ${ce.description} ${ce.maxDescription}`;
}

function getOwnedCeIds() {
  return catalog.bondCraftEssences.filter((ce) => isCeOwned(ce.id)).map((ce) => String(ce.id));
}

function ceTargetKey(target) {
  return `${target?.kind || "regular"}:${Number(target?.index)}:${Number.isInteger(target?.extraIndex) ? target.extraIndex : ""}`;
}

function getActiveOwnCeSelections() {
  const friendIndex = getFriendIndex();
  return state.slots.flatMap((slot, index) => {
    if (index === friendIndex) return [];
    const regular = slot.ceId ? [{ index, kind: "regular", extraIndex: null, ceId: String(slot.ceId) }] : [];
    if (!isGrandServantSlot(index)) return regular;
    const grand = Array.from({ length: GRAND_CE_SLOTS }, (_, extraIndex) => ({
      index,
      kind: "grand",
      extraIndex,
      ceId: String(slot.grandCeIds?.[extraIndex] || ""),
    })).filter((selection) => selection.ceId);
    return [...regular, ...grand];
  });
}

function normalizeActiveOwnCeSelections() {
  const used = new Set();
  let changed = false;
  getActiveOwnCeSelections().forEach((selection) => {
    const id = selection.ceId;
    const invalid = !isCeOwned(id) || used.has(id);
    if (invalid) {
      const slot = state.slots[selection.index];
      if (selection.kind === "grand") slot.grandCeIds[selection.extraIndex] = "";
      else slot.ceId = "";
      changed = true;
      return;
    }
    used.add(id);
  });
  return changed;
}

function canUseCeAtTarget(ceId, target = activeCeTarget) {
  if (!ceId || !target) return false;
  if (target.index === getFriendIndex()) return true;
  if (!isCeOwned(ceId)) return false;
  const targetKey = ceTargetKey(target);
  return !getActiveOwnCeSelections().some((selection) => (
    selection.ceId === String(ceId) && ceTargetKey(selection) !== targetKey
  ));
}

function clearUnownedCeFromOwnSlots(ceId) {
  const id = String(ceId);
  const friendIndex = getFriendIndex();
  state.slots.forEach((slot, index) => {
    if (index === friendIndex) return;
    if (String(slot.ceId) === id) slot.ceId = "";
    slot.grandCeIds = Array.from({ length: GRAND_CE_SLOTS }, (_, extraIndex) => (
      String(slot.grandCeIds?.[extraIndex]) === id ? "" : String(slot.grandCeIds?.[extraIndex] || "")
    ));
  });
}

function setCeOwned(ceId, owned) {
  const id = String(ceId || "");
  if (!id) return;
  if (owned) unownedCeIds.delete(id);
  else {
    unownedCeIds.add(id);
    clearUnownedCeFromOwnSlots(id);
  }
  persistUnownedCes();
  recommendation = null;
  recommendationSignature = "";
  dataStatus = owned ? "已标记为持有羁绊礼装" : "已标记为未持有，并移除本方已装备的该礼装";
  render();
  renderOwnedCePicker();
  if (elements.ceModal?.open) renderCePicker();
}

function getCeEffectById(ceId, ceMlb, profile, isSupport = false) {
  const ce = ceMap.get(String(ceId)) || null;
  if (!ce) return null;
  const effect = parseBondEffect(ce, ceMlb, { isSupport });
  return {
    ce,
    effect,
    selfApplies: effect.parsed && effect.target === "self" && matchesCondition(profile, effect.condition),
  };
}

function getCeEffect(slot, profile, isSupport = false) {
  return getCeEffectById(slot.ceId, slot.ceMlb, profile, isSupport);
}

function conditionMentionsValue(condition, value) {
  const normalizedValue = normalizeConditionRequirement(value);
  if (!normalizedValue) return false;
  return String(condition || "").split(/[或/／]/).some((alternative) => (
    alternative.split(/[且・&＆]/).some((requirement) => (
      normalizeConditionRequirement(requirement) === normalizedValue
    ))
  ));
}

function getBondRelevantTraits(profile) {
  if (!profile) return [];
  const conditions = catalog.bondCraftEssences
    .map((ce) => parseBondEffect(ce, true).condition)
    .filter(Boolean);
  if (!conditions.length) return [];

  const traits = [];
  const addWhenRelevant = (label, candidates = [label]) => {
    if (!label || traits.includes(label)) return;
    if (candidates.some((candidate) => conditions.some((condition) => conditionMentionsValue(condition, candidate)))) {
      traits.push(label);
    }
  };

  const classLabel = labelForClass(profile.className);
  addWhenRelevant(classLabel, [profile.className, classLabel]);
  const subAttributeLabel = profile.subAttribute === "星" ? "拥有星之力" : profile.subAttribute;
  addWhenRelevant(subAttributeLabel, [profile.subAttribute, subAttributeLabel]);
  addWhenRelevant(profile.gender);
  (profile.attributes || []).forEach((attribute) => addWhenRelevant(attribute));
  (profile.traits || []).forEach((trait) => addWhenRelevant(trait));
  if (["Saber", "Archer", "Lancer", "Rider", "Caster", "Assassin", "Berserker"].includes(profile.className)
    && conditions.some((condition) => conditionMentionsValue(condition, "七骑士"))) {
    traits.push("七骑士");
  }
  if (profile.hasCostume && conditions.some((condition) => /灵衣/.test(condition))) traits.push("持有灵衣");
  return traits;
}

function getActiveCeSources() {
  const friendIndex = getFriendIndex();
  return state.slots.flatMap((slot, index) => {
    const profile = getProfile(slot);
    if (!profile) return [];
    const isSupport = index === friendIndex;
    const regular = { index, profile, source: getCeEffect(slot, profile, isSupport) };
    if (!isGrandServantSlot(index)) return [regular];
    const grand = Array.from({ length: GRAND_CE_SLOTS }, (_, extraIndex) => ({
      index,
      profile,
      source: getCeEffectById(slot.grandCeIds?.[extraIndex], slot.grandCeMlbs?.[extraIndex], profile, isSupport),
    }));
    return [regular, ...grand];
  });
}

function calculateSlotBonuses() {
  const friendIndex = getFriendIndex();
  const hasFriendServant = Boolean(getServant(state.slots[friendIndex]));
  const guideCount = state.slots.reduce((count, slot, index) => (
    index !== friendIndex && Number(slot.level) >= 15 && slot.guideEnabled ? count + 1 : count
  ), 0);
  const ceSources = getActiveCeSources();
  const partySources = ceSources.filter(({ source }) => (
    source?.effect.parsed
    && source.effect.target === "party"
    && (source.effect.percent > 0 || source.effect.flat > 0)
  ));

  return state.slots.map((slot, index) => {
    const profile = getProfile(slot);
    const formation = getFormationBondBonus({ index, friendIndex, hasFriendServant });
    const selfCe = ceSources.reduce((sum, entry) => (
      entry.index === index && entry.source?.selfApplies ? sum + entry.source.effect.percent : sum
    ), 0);
    const selfFlat = ceSources.reduce((sum, entry) => (
      entry.index === index && entry.source?.selfApplies ? sum + entry.source.effect.flat : sum
    ), 0);
    const partyCe = partySources.reduce((sum, source) => (
      matchesCondition(profile, source.source.effect.condition) ? sum + source.source.effect.percent : sum
    ), 0);
    const partyFlat = partySources.reduce((sum, source) => (
      matchesCondition(profile, source.source.effect.condition) ? sum + source.source.effect.flat : sum
    ), 0);
    const global = numberOr(state.partyBonus) + guideCount * 25 + partyCe;
    const personal = selfCe + numberOr(slot.eventBonus);
    const formationTotal = formation.party + formation.personal;
    return {
      global,
      personal,
      formationBonus: formationTotal,
      globalFlat: partyFlat,
      personalFlat: selfFlat,
      guideCount,
      selfCe,
      selfFlat,
      partyCe,
      partyFlat,
      formationPersonal: formation.personal,
      formationParty: formation.party,
      formationTotal,
      otherTotal: global + personal,
      total: global + personal + formationTotal,
      flatTotal: partyFlat + selfFlat,
    };
  });
}

function getActiveTeaPotCount() {
  return state.teaPotEnabled ? normalizeTeaPotCount(state.teaPotCount) : 0;
}

function getContextForSlot(index, bonuses, teaPotCount = getActiveTeaPotCount()) {
  return {
    baseBond: getBaseBond(),
    globalBonus: bonuses[index].global,
    personalBonus: bonuses[index].personal,
    formationBonus: bonuses[index].formationBonus,
    flatBonus: bonuses[index].globalFlat + bonuses[index].personalFlat,
    bonusCap: state.bonusCap,
    teaPotCount,
  };
}

function getSlotCost(slot, index) {
  return calculateFormationSlotCost({
    servantCost: getServant(slot)?.cost,
    regularCeCost: getCe(slot)?.cost,
    isFriend: index === getFriendIndex(),
    isGrandServant: isGrandServantSlot(index),
  });
}

function getCostSummary() {
  const used = state.slots.reduce((sum, slot, index) => sum + getSlotCost(slot, index), 0);
  const cap = Math.max(0, numberOr(state.costCap));
  return { used, cap, remaining: cap - used };
}

function getFormationBondSummary(bonuses = calculateSlotBonuses()) {
  return state.slots.reduce((summary, slot, index) => {
    const profile = getProfile(slot);
    if (!hasCompleteProfile(profile) || !isGrandCompatible(profile)) return summary;
    const calculation = calculateSlot({ ...slot, profile }, getContextForSlot(index, bonuses));
    summary.normalTotal += Math.max(0, numberOr(calculation.normalBattle?.gain));
    summary.teaPotTotal += Math.max(0, numberOr(calculation.teaPotBattle?.gain));
    summary.members += 1;
    return summary;
  }, { normalTotal: 0, teaPotTotal: 0, members: 0 });
}

function renderMode() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
  });
  elements.normalSettings.classList.toggle("hidden", state.mode !== "normal");
  elements.grandSettings.classList.toggle("hidden", state.mode !== "grand");
}

function renderGrandOptions() {
  elements.grandClass.innerHTML = GRAND_CLASSES
    .map((className) => `<option value="${className}">${escapeHtml(labelForClass(className))}</option>`)
    .join("");
  elements.grandClass.value = state.grandClass;
  const options = catalog.grandBattles.filter((battle) => battle.className === state.grandClass);
  if (!options.some((battle) => battle.id === state.grandBattleId)) state.grandBattleId = options[0]?.id || "";
  elements.grandBattle.innerHTML = options.length
    ? options.map((battle) => `<option value="${escapeHtml(battle.id)}">${escapeHtml(battle.name)} · ${formatNumber(battle.baseBond)}</option>`).join("")
    : '<option value="">未加载关卡数据</option>';
  elements.grandBattle.value = state.grandBattleId;
  elements.grandSource.href = getCurrentGrandBattle()?.sourceUrl || "https://fgo.wiki/w/%E5%88%86%E7%B1%BB:%E5%86%A0%E4%BD%8D%E6%88%B4%E5%86%A0%E6%88%98";
}

function renderMasterEquipOptions() {
  if (!elements.masterEquip) return;
  elements.masterEquip.innerHTML = BBC_MASTER_EQUIPS
    .map(({ sn, name }) => `<option value="${sn}">${escapeHtml(name)}</option>`)
    .join("");
  state.masterEquip = normalizeBbchannelMasterEquip(state.masterEquip);
  elements.masterEquip.value = String(state.masterEquip);
  const selected = BBC_MASTER_EQUIPS.find(({ sn }) => sn === state.masterEquip) || BBC_MASTER_EQUIPS[0];
  if (elements.masterEquipHint) {
    elements.masterEquipHint.textContent = `导出 BBC 时写入 master_equip：${selected.sn}`;
    elements.masterEquipHint.title = `BBchannel master_info.json：${selected.name}`;
  }
}

function renderSettings() {
  elements.normalBaseBond.value = Math.max(0, numberOr(state.normalBaseBond));
  elements.friendPosition.innerHTML = Array.from({ length: 6 }, (_, index) => `<option value="${index + 1}">位置 ${index + 1}</option>`).join("");
  elements.friendPosition.value = state.friendPosition;
  elements.costCap.value = Math.max(0, numberOr(state.costCap));
  elements.teaPotEnabled.checked = Boolean(state.teaPotEnabled);
  elements.teaPotCount.value = normalizeTeaPotCount(state.teaPotCount);
  elements.partyBonus.value = numberOr(state.partyBonus);
  elements.bonusCap.value = Math.max(0, numberOr(state.bonusCap, 500));
  elements.battleCount.value = Math.max(1, Math.floor(numberOr(state.battleCount, 1)));
  renderGrandOptions();
  renderMasterEquipOptions();
}

function getLineupPayload() {
  const { history, logs, ...payload } = state;
  return clone(payload);
}

function renderLineups() {
  const entries = Object.entries(savedLineups)
    .filter(([name, entry]) => name && entry?.state)
    .sort((left, right) => String(right[1].savedAt || "").localeCompare(String(left[1].savedAt || "")));
  if (selectedLineupName && !entries.some(([name]) => name === selectedLineupName)) selectedLineupName = "";
  elements.savedLineups.innerHTML = `<option value="">已保存的编队</option>${entries.map(([name, entry]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)} · ${escapeHtml(new Date(entry.savedAt).toLocaleDateString("zh-CN"))}</option>`).join("")}`;
  elements.savedLineups.value = selectedLineupName;
  if (document.activeElement !== elements.lineupName) elements.lineupName.value = lineupNameDraft;
}

function formatRewards(rewards) {
  return rewards.map((reward) => `<span class="reward-token">${escapeHtml(reward.name)} ×${formatNumber(reward.quantity)}</span>`).join("");
}

function formatBattlePlan(plan) {
  if (!plan) return "--";
  if (plan.teaPotBattles > 0) {
    return `${formatNumber(plan.battles)} 场（茶壶 ${formatNumber(plan.teaPotBattles)} 场 + 普通 ${formatNumber(plan.normalBattles)} 场）`;
  }
  return `${formatNumber(plan.battles)} 场`;
}

function renderResult(profile, calculation) {
  if (!hasCompleteProfile(profile)) {
    const loading = profileLoading.has(String(profile?.id));
    const error = profileErrors.get(String(profile?.id));
    return `<div class="slot-result"><div class="empty-result ${error ? "warning" : ""}">${escapeHtml(error || (loading ? "正在读取 Mooncell 羁绊数据" : "等待羁绊数据"))}</div></div>`;
  }
  const battle = calculation.normalBattle || calculation.battle;
  const baseGain = Math.max(0, Math.floor(numberOr(battle.baseGain, battle.gain)));
  const bonusGain = Math.max(0, Math.floor(numberOr(battle.bonusGain, battle.gain - baseGain)));
  const resultPrimary = `<div class="result-primary"><span>单场合计</span><strong>+${formatNumber(battle.gain)}</strong><span class="result-breakdown">基础 +${formatNumber(baseGain)} · 加成 +${formatNumber(bonusGain)}</span></div>`;
  const teaPotDetail = calculation.teaPotCount > 0
    ? `<div class="result-secondary tea-pot-detail">茶壶场 +${formatNumber(calculation.teaPotBattle?.gain || battle.gain)} · 库存 ${formatNumber(calculation.teaPotCount)} 个</div>`
    : "";
  const rewards = calculation.nextReward?.length
    ? `<div class="next-reward"><span>下一阶段奖励</span><div class="reward-list">${formatRewards(calculation.nextReward)}</div></div>`
    : "";
  if (calculation.ceilingMessage) {
    return `<div class="slot-result">${resultPrimary}${teaPotDetail}<div class="result-secondary warning">${escapeHtml(calculation.ceilingMessage)}</div>${rewards}</div>`;
  }
  const capNotice = battle.capped ? `<span class="warning">加成按 ${formatNumber(battle.appliedBonus)}% 上限计</span>` : "";
  const battleTarget = calculation.level < 10 ? "到 Lv.10 还需" : "还需";
  return `<div class="slot-result">${resultPrimary}${teaPotDetail}<div class="result-secondary">Lv.${calculation.level} → Lv.${calculation.nextLevel}：剩余 ${formatNumber(calculation.remaining)} / ${formatNumber(calculation.requirement)}</div><div class="result-secondary">${battleTarget} ${formatBattlePlan(calculation.battlePlan)} ${capNotice}</div>${rewards}</div>`;
}

function renderServantIdentity(servant, profile) {
  if (!servant) return '<button class="servant-picker empty" type="button" draggable="false" data-action="pick-servant" aria-label="选择从者" title="选择从者；可作为从者拖放目标"><span class="empty-portrait" aria-hidden="true">+</span><span>选择从者</span></button>';
  const image = servant.avatar
    ? `<img class="servant-avatar" src="${escapeHtml(servant.avatar)}" alt="${escapeHtml(profile?.name || servant.name)}" loading="lazy" />`
    : `<div class="avatar-fallback">${escapeHtml(labelForClass(profile?.className || servant.className).slice(0, 1))}</div>`;
  const stars = "★".repeat(Math.max(0, numberOr(profile?.star || servant.star)));
  return `<button class="servant-picker" type="button" draggable="true" data-action="pick-servant" title="拖动头像框交换位置；点击选择从者：${escapeHtml(profile?.name || servant.name)}">${image}<span class="servant-identity"><span class="servant-name">${escapeHtml(profile?.name || servant.name)}</span><span class="servant-meta">${escapeHtml(labelForClass(profile?.className || servant.className))} · ${stars || "特殊"}</span></span></button>`;
}

function levelOptions(value) {
  return Array.from({ length: 17 }, (_, level) => `<option value="${level}" ${Number(value) === level ? "selected" : ""}>Lv.${level}</option>`).join("");
}

function renderCeVisual(ce, {
  action,
  extraIndex = null,
  clearAction = "",
  isSupport = false,
  disabled = false,
  label,
  slotIndex,
  kind = "regular",
  mlb = true,
}) {
  const effect = ce ? parseBondEffect(ce, true, { isSupport }) : null;
  const detail = ce ? `${ce.name} · ${effect?.text || ce.description || "未识别效果"} · Cost ${formatNumber(ce.cost)}` : `选择${label}`;
  const dataExtra = extraIndex === null ? "" : ` data-extra-index="${extraIndex}"`;
  const ceTargetAttrs = Number.isInteger(slotIndex) && !disabled
    ? ` data-ce-drop-target="true" data-ce-kind="${kind}" data-ce-slot-index="${slotIndex}"${dataExtra}`
    : "";
  const ceSourceAttrs = ce && !disabled
    ? ` draggable="true" data-ce-drag-source="true" data-ce-kind="${kind}" data-ce-slot-index="${slotIndex}"${dataExtra}`
    : ' draggable="false"';
  const image = ce?.avatar
    ? `<img src="${escapeHtml(ce.avatar)}" alt="" loading="lazy" />`
    : `<span class="ce-empty-mark" aria-hidden="true">+</span>`;
  // 满破礼装在游戏内右下角会带一颗星，账本按同样的位置标出，便于与 BBC 模板对照。
  const star = ce && mlb ? '<span class="ce-mlb-star" aria-hidden="true">★</span>' : "";
  const remove = ce && clearAction
    ? `<button class="ce-remove" type="button" data-action="${clearAction}"${dataExtra} aria-label="移除${escapeHtml(label)}" title="移除${escapeHtml(label)}">×</button>`
    : "";
  return `<span class="equipment-item"${ceTargetAttrs}><button class="ce-visual ${ce ? "" : "empty"}" type="button" data-action="${action}"${dataExtra}${ceSourceAttrs} ${disabled ? "disabled" : ""} aria-label="${escapeHtml(detail)}" title="${escapeHtml(detail)}">${image}${star}</button>${remove}</span>`;
}

function renderSlot(slot, index, bonuses) {
  const friend = index === getFriendIndex();
  const servant = getServant(slot);
  const profile = getProfile(slot);
  const ce = getCe(slot);
  const completeProfile = hasCompleteProfile(profile);
  const mismatch = servant && !isGrandCompatible(profile);
  const calculation = servant && !friend && !mismatch ? calculateSlot({ ...slot, profile }, getContextForSlot(index, bonuses)) : null;
  const traits = getBondRelevantTraits(profile);
  const traitText = traits.join(" · ");
  const disabled = !servant ? "disabled" : "";
  const grandServant = isGrandServantSlot(index);
  const slotCost = getSlotCost(slot, index);
  const grandRoleDisabled = !servant || mismatch ? "disabled" : "";
  const grandRole = state.mode === "grand"
    ? `<label class="toggle-row grand-role-toggle" title="冠位从者最多装备两张羁绊加成礼装：一张常规礼装（计入 Cost）和一张冠位礼装（不计 Cost）"><input type="checkbox" data-grand-role="${friend ? "friend" : "own"}" ${grandServant ? "checked" : ""} ${grandRoleDisabled} /><span>${friend ? "好友冠位从者" : "本方冠位从者"}</span></label>`
    : "";
  const grandCraftEssences = grandServant
    ? Array.from({ length: GRAND_CE_SLOTS }, (_, extraIndex) => {
      const extraCe = getGrandCe(slot, extraIndex);
      const extraLabel = "冠位羁绊加成礼装";
      return `<span class="grand-ce-item">${renderCeVisual(extraCe, { action: "pick-grand-ce", clearAction: "clear-grand-ce", extraIndex, isSupport: friend, disabled: Boolean(disabled), label: extraLabel, slotIndex: index, kind: "grand", mlb: slot.grandCeMlbs?.[extraIndex] !== false })}${extraCe ? `<label class="ce-mlb-toggle" title="${extraLabel}满破"><input type="checkbox" data-grand-ce-mlb="${extraIndex}" ${slot.grandCeMlbs?.[extraIndex] !== false ? "checked" : ""} /><span>满破</span></label>` : ""}</span>`;
    }).join("")
    : "";
  const friendBadge = bonuses[index]?.formationParty
    ? '<button class="friend-badge friend-drag-handle" type="button" draggable="true" data-friend-drag-source="true" title="拖动好友标记到其他位置；好友位处于前排时全队牵绊 +4%">好友 +4%</button>'
    : '<button class="friend-badge friend-drag-handle" type="button" draggable="true" data-friend-drag-source="true" title="拖动好友标记到其他位置">好友</button>';
  // 冠位从者的两张可选羁绊加成礼装由常规礼装格和一张冠位专用格组成。
  // 常规礼装计入本方 Cost，冠位专用礼装不计 Cost。
  const regularCe = renderCeVisual(ce, {
    action: "pick-ce",
    clearAction: "clear-ce",
    isSupport: friend,
    disabled: Boolean(disabled),
    label: "常规羁绊加成礼装",
    slotIndex: index,
    kind: "regular",
    mlb: slot.ceMlb !== false,
  });
  const regularCeItem = `<span class="regular-ce-item">${regularCe}${ce ? `<label class="ce-mlb-toggle" title="常规羁绊加成礼装满破"><input type="checkbox" data-slot-field="ceMlb" ${slot.ceMlb !== false ? "checked" : ""} /><span>满破</span></label>` : ""}</span>`;
  const remainingValue = calculation?.remaining ?? 0;
  const remainingDisabled = !completeProfile || !servant || mismatch || Number(slot.level) >= 16 ? "disabled" : "";
  const ownFields = friend ? "" : `<div class="slot-fields">
      <label class="field-label">牵绊等级<select data-slot-field="level" ${disabled}>${levelOptions(slot.level)}</select></label>
      <label class="field-label" title="升至下一牵绊等级仍需的点数">升级剩余<input type="number" min="1" step="1" inputmode="numeric" data-slot-field="remaining" value="${Math.max(0, Math.floor(numberOr(remainingValue)))}" ${remainingDisabled} /></label>
      <label class="toggle-row guide-toggle" title="Lv.15 解锁的队伍羁绊加成"><input type="checkbox" data-slot-field="guideEnabled" ${slot.guideEnabled ? "checked" : ""} ${Number(slot.level) < 15 || !servant ? "disabled" : ""} /><span>梦火的引导</span></label>
      <label class="toggle-row" title="至诚的一针等礼装会根据该状态判定"><input type="checkbox" data-slot-field="hasCostume" ${slot.hasCostume ? "checked" : ""} ${disabled} /><span>持有灵衣</span></label>
      <div class="recommendation-target"><label class="toggle-row"><input type="checkbox" data-slot-field="recommendationTarget" ${slot.recommendationTarget ? "checked" : ""} ${disabled} /><span>此从者牵绊最大化</span></label><span class="target-help" tabindex="0" role="img" aria-label="说明：选中一个或多个从者后，礼装推荐只最大化这些从者的单场牵绊；未选中时，推荐以全部非好友从者为目标。" data-tooltip="选中一个或多个从者后，礼装推荐只最大化这些从者的单场牵绊；未选中时，推荐以全部非好友从者为目标。">?</span></div>
      <label class="field-label full">活动加成 (%)<input type="number" min="0" step="0.1" inputmode="decimal" data-slot-field="eventBonus" value="${numberOr(slot.eventBonus)}" ${disabled} /></label>
    </div>`;
  // 推荐紧跟单场计算结果；好友位没有单场合计，显示在其 Cost 提示下方。
  const resultMarkup = friend
    ? ""
    : (mismatch
      ? '<div class="slot-result"><div class="empty-result warning">冠位模式下不可编入</div></div>'
      : (calculation ? renderResult(profile, calculation) : ""));
  const recommendationMarkup = renderSlotRecommendation(index);

  return `<article class="slot-card ${friend ? "friend" : ""} ${mismatch ? "invalid-grand" : ""}" data-slot="${index}" data-friend-drop-target="true" draggable="${friend ? "true" : "false"}">
    <div class="slot-title"><span class="slot-position">${POSITION_LABELS[index] || `位置 ${index + 1}`}</span><span class="slot-title-actions">${friend ? friendBadge : `<span class="mode-badge">${formatBonusBadge(bonuses[index])}</span>`}</span></div>
    ${renderServantIdentity(servant, profile)}
    <div class="trait-line ${traitText ? "" : "empty"}" title="${escapeHtml(traitText)}">${escapeHtml(traitText)}</div>
    ${mismatch ? `<div class="trait-line warning">不符合 ${escapeHtml(grandRestrictionLabel())} 编队条件</div>` : ""}
    <div class="slot-loadout">
      ${grandRole}
       ${regularCeItem}
       ${grandCraftEssences ? `<span class="grand-ce-list">${grandCraftEssences}</span>` : ""}
    </div>
    ${ownFields}
    <div class="slot-bottom">${servant ? `<div class="slot-cost">${friend ? "好友位 Cost 不计入总计" : `本位 Cost ${formatNumber(slotCost)}`}${grandServant ? " · 常规礼装计入；冠位礼装不计 Cost" : ""}${completeProfile ? "" : " · 正在补全数据"}</div>` : ""}${resultMarkup}${recommendationMarkup}</div>
  </article>`;
}

function renderRoster() {
  const bonuses = calculateSlotBonuses();
  elements.partyGrid.innerHTML = state.slots.map((slot, index) => renderSlot(slot, index, bonuses)).join("");
  state.slots.forEach((slot) => {
    const profile = getProfile(slot);
    if (slot.servantId && !hasCompleteProfile(profile) && !profileLoading.has(String(slot.servantId)) && !profileErrors.has(String(slot.servantId))) void ensureProfile(slot.servantId);
  });
}

function renderSummary() {
  const cost = getCostSummary();
  const overCost = cost.remaining < 0;
  elements.costSummary.className = `cost-summary ${overCost ? "over-cost" : ""}`;
  elements.costSummary.innerHTML = overCost ? `<span>Cost</span><strong>${formatNumber(cost.used)} / ${formatNumber(cost.cap)} · 超出 ${formatNumber(-cost.remaining)}</strong>` : `<span>Cost</span><strong>${formatNumber(cost.used)} / ${formatNumber(cost.cap)}</strong><span>剩余 ${formatNumber(cost.remaining)}</span>`;
  // 编队区内的常驻提醒，不使用弹窗：超限即显示，回到上限内自动隐藏。
  elements.costWarning.classList.toggle("hidden", !overCost);
  elements.costWarning.innerHTML = overCost
    ? `<strong>编队 Cost 超出上限</strong><span>当前 ${formatNumber(cost.used)} / ${formatNumber(cost.cap)}，超出 ${formatNumber(-cost.remaining)}，请减少从者或礼装。</span>`
    : "";
  const battle = getCurrentGrandBattle();
  const label = state.mode === "normal" ? `基础羁绊 ${formatNumber(getBaseBond())}` : `${escapeHtml(battle?.name || "未选择关卡")} · ${formatNumber(getBaseBond())}`;
  const formation = getFormationBondSummary();
  const activeTeaPots = getActiveTeaPotCount();
  const stockTeaPots = normalizeTeaPotCount(state.teaPotCount);
  const teaPotSummary = activeTeaPots > 0
    ? `<span class="mini-badge" title="前 ${formatNumber(activeTeaPots)} 场将消耗占星茶壶，整队牵绊翻倍">茶壶 ${formatNumber(activeTeaPots)} 个 · +${formatNumber(formation.teaPotTotal)} / 场</span>`
    : stockTeaPots > 0
      ? `<span class="mini-badge muted" title="已填写茶壶库存，但“使用占星茶壶”当前未开启">茶壶库存 ${formatNumber(stockTeaPots)} 个 · 未启用</span>`
      : "";
  elements.battleSummary.innerHTML = `<span>${label}</span><strong class="formation-total" title="不含好友位，按当前编队和礼装计算的普通场次总牵绊">编队总牵绊 +${formatNumber(formation.normalTotal)} / 场</strong>${teaPotSummary}`;
  elements.dataStatus.textContent = dataStatus || (catalog.servants.length ? `已载入 ${catalog.servants.length} 骑从者` : "等待 Mooncell 图鉴数据");
  const date = catalog.syncedAt ? new Date(catalog.syncedAt).toLocaleString("zh-CN", { hour12: false }) : "内置规则";
  elements.sourceMeta.textContent = `数据：${catalog.source || "Mooncell"} · ${date}`;
}

function renderLogs() {
  elements.battleLog.innerHTML = state.logs.length ? state.logs.slice(0, 4).map((entry) => `<div class="log-item">${escapeHtml(entry)}</div>`).join("") : "";
  document.querySelector("#undo-battles").disabled = state.history.length === 0;
}

function getRecommendationSignature() {
  return JSON.stringify({
    mode: state.mode,
    normalBaseBond: state.normalBaseBond,
    grandClass: state.grandClass,
    grandBattleId: state.grandBattleId,
    grandOwnPosition: state.grandOwnPosition,
    friendGrandServant: state.friendGrandServant,
    friendPosition: state.friendPosition,
    costCap: state.costCap,
    teaPotEnabled: Boolean(state.teaPotEnabled),
    teaPotCount: state.teaPotCount,
    partyBonus: state.partyBonus,
    bonusCap: state.bonusCap,
    unownedCeIds: [...unownedCeIds].sort(),
    slots: state.slots,
  });
}

function getRecommendationTargetIndices() {
  const friendIndex = getFriendIndex();
  return state.slots
    .map((slot, index) => (index !== friendIndex && slot.recommendationTarget ? index : -1))
    .filter((index) => index >= 0);
}

function getSlotDisplayName(index) {
  const slot = state.slots[index] || {};
  const profile = getProfile(slot);
  const name = profile?.name || getServant(slot)?.name || "未选择从者";
  return index === getFriendIndex() ? `${name}（好友）` : name;
}

function getRecommendationTargetLabel() {
  const selected = getRecommendationTargetIndices();
  return selected.length ? selected.map(getSlotDisplayName).join("、") : "全队非好友从者";
}

function getRecommendationAssignmentLabel(assignment) {
  const kind = assignment.kind === "grand"
    ? "冠位羁绊加成礼装"
    : (isGrandServantSlot(assignment.index) ? "常规羁绊加成礼装（计 Cost）" : "羁绊加成礼装");
  return `${getSlotDisplayName(assignment.index)} · ${kind}`;
}

function getRecommendationAssignmentsForSlot(index) {
  if (!recommendation || recommendationSignature !== getRecommendationSignature()) return [];
  return recommendation.assignments.filter((assignment) => assignment.index === index);
}

function renderSlotRecommendation(index) {
  const assignments = getRecommendationAssignmentsForSlot(index);
  if (!assignments.length) return "";
  const items = assignments.map((assignment) => {
    const ce = ceMap.get(String(assignment.ceId));
    const image = ce?.avatar
      ? `<img src="${escapeHtml(ce.avatar)}" alt="" loading="lazy" />`
      : '<span class="ce-empty-mark" aria-hidden="true">礼</span>';
    const cost = assignment.countsCost ? `Cost ${formatNumber(assignment.ceCost)}` : "不计 Cost";
    const kind = assignment.kind === "grand"
      ? "冠位羁绊加成礼装"
      : (isGrandServantSlot(index) ? "常规羁绊加成礼装" : "羁绊加成礼装");
    return `<div class="slot-recommendation-item"><span class="slot-recommendation-image">${image}</span><span class="slot-recommendation-copy"><strong>${escapeHtml(assignment.ceName || ce?.name || "未命名礼装")}</strong><span>${escapeHtml(kind)} · ${cost}</span></span></div>`;
  }).join("");
  return `<div class="slot-recommendation"><div class="slot-recommendation-heading"><span>推荐礼装</span><span>按当前目标最大化</span></div><div class="slot-recommendation-list">${items}</div></div>`;
}

function renderRecommendation() {
  if (!elements.recommendationPanel || !elements.recommendationOutput || !elements.applyRecommendation) return;
  if (!recommendation || recommendationSignature !== getRecommendationSignature()) {
    recommendation = null;
    recommendationSignature = "";
    elements.recommendationPanel.classList.add("hidden");
    elements.applyRecommendation.disabled = true;
    return;
  }

  elements.recommendationPanel.classList.remove("hidden");
  elements.applyRecommendation.disabled = recommendation.status !== "ok" || recommendation.assignments.length === 0;
  const solverStatus = recommendation.isExact
    ? `已验证最优 · 搜索 ${formatNumber(recommendation.nodesVisited)} 个状态`
    : `已返回当前最优候选 · 已搜索 ${formatNumber(recommendation.nodesVisited)} 个状态`;
  const results = recommendation.perSlot.map((entry) => {
    const modifiers = [];
    if (numberOr(entry.otherBonus) > 0) modifiers.push(`其他 +${formatPercent(entry.otherBonus)}%`);
    if (numberOr(entry.formationBonus) > 0) modifiers.push(`编队 +${formatPercent(entry.formationBonus)}%`);
    if (numberOr(entry.flatBonus) > 0) modifiers.push(`+${formatNumber(entry.flatBonus)} 点`);
    const extra = numberOr(entry.bonusGain, entry.gain - numberOr(entry.baseGain, getBaseBond()));
    return `<span class="recommendation-result">${escapeHtml(entry.name)} · +${formatNumber(entry.gain)}（加成 +${formatNumber(extra)}）${modifiers.length ? ` · ${escapeHtml(modifiers.join(" · "))}` : ""}</span>`;
  }).join("");
  elements.recommendationOutput.innerHTML = `<div class="recommendation-meta"><span>目标合计 +${formatNumber(recommendation.totalGain)} / 场</span><span>目标：${escapeHtml(getRecommendationTargetLabel())}</span><span>Cost ${formatNumber(recommendation.finalCost)} / ${formatNumber(recommendation.costCap)}</span><span>${solverStatus}</span></div><div class="recommendation-hint">推荐礼装已显示在对应从者卡片下方，可直接点击“应用方案”写入编队。</div><div class="recommendation-results">${results}</div>${recommendation.message ? `<div class="result-secondary warning">${escapeHtml(recommendation.message)}</div>` : ""}`;
}

function recommendCraftEssences() {
  const slots = state.slots.map((slot) => ({ ...slot, profile: getProfile(slot) }));
  recommendation = recommendBondCraftEssences({
    ceList: catalog.bondCraftEssences,
    slots,
    friendIndex: getFriendIndex(),
    targetIndices: getRecommendationTargetIndices(),
    grandOwnIndex: state.mode === "grand" ? Number(state.grandOwnPosition) - 1 : -1,
    friendGrandServant: state.mode === "grand" && state.friendGrandServant,
    baseBond: getBaseBond(),
    partyBonus: state.partyBonus,
    bonusCap: state.bonusCap,
    teaPot: getActiveTeaPotCount() > 0,
    costCap: state.costCap,
    ownedCeIds: getOwnedCeIds(),
  });
  recommendationSignature = getRecommendationSignature();
  dataStatus = recommendation.isExact ? "已生成最大化礼装方案" : "已生成当前最优候选方案";
  render();
}

function applyRecommendation() {
  if (!recommendation || recommendationSignature !== getRecommendationSignature()) return;
  state.slots.forEach((slot) => {
    slot.ceId = "";
    slot.ceMlb = true;
    slot.grandCeIds = Array.from({ length: GRAND_CE_SLOTS }, () => "");
    slot.grandCeMlbs = Array.from({ length: GRAND_CE_SLOTS }, () => true);
  });
  recommendation.assignments.forEach((assignment) => {
    const slot = state.slots[assignment.index];
    if (!slot) return;
    if (assignment.kind === "grand") {
      slot.grandCeIds[assignment.extraIndex] = String(assignment.ceId);
      slot.grandCeMlbs[assignment.extraIndex] = true;
    } else {
      slot.ceId = String(assignment.ceId);
      slot.ceMlb = true;
    }
  });
  dataStatus = "已应用最大化礼装方案";
  recommendation = null;
  recommendationSignature = "";
  render();
}

function render() {
  normalizeActiveOwnCeSelections();
  renderMode();
  renderLineups();
  renderSettings();
  renderRoster();
  renderSummary();
  renderLogs();
  renderRecommendation();
  persistState();
}

function saveLineup() {
  const name = String(elements.lineupName.value || lineupNameDraft || "").trim();
  if (!name) {
    dataStatus = "请输入编队档案名称";
    renderSummary();
    elements.lineupName.focus();
    return;
  }
  savedLineups[name] = { savedAt: new Date().toISOString(), state: getLineupPayload() };
  selectedLineupName = name;
  lineupNameDraft = name;
  persistLineups();
  dataStatus = `已保存编队：${name}`;
  render();
}

function loadLineup() {
  const entry = savedLineups[selectedLineupName];
  if (!entry?.state) {
    dataStatus = "请选择已保存的编队";
    renderSummary();
    return;
  }
  state = normalizeState({ ...entry.state, history: [], logs: [`已载入编队：${selectedLineupName}`] });
  lineupNameDraft = selectedLineupName;
  render();
}

function deleteLineup() {
  const entry = savedLineups[selectedLineupName];
  if (!entry) {
    dataStatus = "请选择已保存的编队";
    renderSummary();
    return;
  }
  if (!window.confirm(`删除编队档案“${selectedLineupName}”？`)) return;
  delete savedLineups[selectedLineupName];
  dataStatus = `已删除编队：${selectedLineupName}`;
  selectedLineupName = "";
  lineupNameDraft = "";
  persistLineups();
  render();
}

async function ensureProfile(servantId) {
  const id = String(servantId);
  if (hasCompleteProfile(catalog.profiles?.[id]) || profileLoading.has(id) || profileErrors.has(id)) return;
  const servant = servantMap.get(id);
  if (!servant) return;
  profileLoading.add(id);
  profileErrors.delete(id);
  render();
  try {
    const profile = parseServantProfile(await fetchWikiText(servant.title), servant);
    if (!hasCompleteProfile(profile)) {
      try {
        const bondPoints = await fetchAtlasBondPoints(servant.id);
        if (bondPoints.length === 10) {
          profile.bondPoints = bondPoints;
          profile.bondSource = "Atlas Academy";
        }
      } catch {
        // Mooncell remains the primary source; the fallback is optional for incomplete pages.
      }
    }
    catalog.profiles[id] = profile;
    recommendation = null;
    recommendationSignature = "";
    if (!hasCompleteProfile(profile)) {
      profileErrors.set(id, "Mooncell 与公开游戏数据均未提供完整羁绊阈值");
    }
  } catch (error) {
    profileErrors.set(id, error instanceof Error ? error.message : "从者数据读取失败");
  } finally {
    profileLoading.delete(id);
    render();
  }
}

function setSlotField(index, field, value) {
  const slot = state.slots[index];
  if (!slot) return;
  if (field === "remaining") {
    const profile = getProfile(slot);
    slot.progress = progressFromRemaining(profile, Math.floor(numberOr(slot.level)), value);
    // 手动录入阶段进度即为用户对当前游戏状态的修正。不能因输入的是
    // “升级剩余最大值”（进度为 0）而重新落回旧的上限提示。
    slot.awaitingUnlock = false;
    return;
  }
  if (!Object.hasOwn(slot, field)) return;
  if (["guideEnabled", "ceMlb", "hasCostume", "recommendationTarget"].includes(field)) {
    slot[field] = Boolean(value);
    return;
  }
  if (field === "level") {
    const previousLevel = Math.min(Math.max(Math.floor(numberOr(slot.level)), 0), 16);
    const nextLevel = Math.min(Math.max(Math.floor(numberOr(value)), 0), 16);
    // 手动调整等级代表用户已按游戏内状态确认当前阶段，始终解除战斗
    // 记录留下的等待解锁状态；提高等级后从新阶段起点开始计算。
    slot.awaitingUnlock = false;
    if (nextLevel !== previousLevel) {
      slot.progress = 0;
    }
    slot.level = nextLevel;
    // 手动提高等级就是用户确认已在游戏内开启该等级；把上限推进到下一级，
    // 否则提示会立刻以新等级再次出现。
    if (nextLevel > previousLevel) {
      slot.unlockedLevel = normalizeUnlockedLevel(Math.max(numberOr(slot.unlockedLevel, 10), nextLevel));
    }
    return;
  }
  slot[field] = Number(value) || 0;
}

function grandPickerAllows(servant) {
  if (state.mode !== "grand") return true;
  return getGrandAllowedClasses().includes(servant.className);
}

function renderServantPicker() {
  const query = normalizeText(elements.servantSearch.value);
  const classFilter = elements.servantClassFilter.value;
  const starFilter = elements.servantStarFilter.value;
  const filtered = catalog.servants.filter((servant) => {
    if (!grandPickerAllows(servant)) return false;
    if (classFilter && servant.className !== classFilter) return false;
    if (starFilter && Number(servant.star) !== Number(starFilter)) return false;
    return !query || [servant.name, servant.title, ...(servant.aliases || [])].some((value) => normalizeText(value).includes(query));
  });
  elements.servantCount.textContent = `显示 ${filtered.length} / ${catalog.servants.filter(grandPickerAllows).length} 骑`;
  elements.servantList.innerHTML = filtered.map((servant) => {
    const image = servant.avatar ? `<img class="servant-avatar" src="${escapeHtml(servant.avatar)}" alt="" loading="lazy" />` : `<div class="avatar-fallback">${escapeHtml(labelForClass(servant.className).slice(0, 1))}</div>`;
    const aliases = servant.aliases?.filter((alias) => alias !== servant.name).slice(0, 4).join(" · ") || "";
    return `<button class="picker-row" type="button" data-select-servant="${escapeHtml(servant.id)}">${image}<span class="picker-main"><span class="picker-name">${escapeHtml(servant.name)}</span><span class="picker-subtitle">${escapeHtml(aliases)}</span></span><span class="picker-side">${escapeHtml(labelForClass(servant.className))}<br>${"★".repeat(Math.max(0, servant.star))} · Cost ${formatNumber(servant.cost)}</span></button>`;
  }).join("") || '<div class="empty-result">没有匹配的从者</div>';
}

function renderCePicker() {
  const query = normalizeText(elements.ceSearch.value);
  const filtered = catalog.bondCraftEssences.filter((ce) => !query || normalizeText(ceSearchText(ce)).includes(query)).slice(0, 150);
  elements.ceCount.textContent = `显示 ${filtered.length} / ${catalog.bondCraftEssences.length} 张`;
  elements.ceList.innerHTML = filtered.map((ce) => {
    const effect = parseBondEffect(ce, true, { isSupport: activeCeTarget?.index === getFriendIndex() });
    const isFriendTarget = activeCeTarget?.index === getFriendIndex();
    const available = canUseCeAtTarget(ce.id);
    const unavailableReason = isFriendTarget
      ? ""
      : (!isCeOwned(ce.id) ? "未持有" : "已被其他本方礼装格使用");
    const detail = `${ce.name} · ${effect.text || ce.description || "未识别效果"} · Cost ${formatNumber(ce.cost)}${unavailableReason ? ` · ${unavailableReason}` : ""}`;
    const image = ce.avatar ? `<img src="${escapeHtml(ce.avatar)}" alt="" loading="lazy" />` : '<span class="ce-empty-mark" aria-hidden="true">礼</span>';
    return `<button class="ce-picker-tile ${available ? "" : "is-unavailable"}" type="button" data-select-ce="${escapeHtml(ce.id)}" aria-label="${escapeHtml(detail)}" title="${escapeHtml(detail)}" ${available ? "" : "disabled"}>${image}</button>`;
  }).join("") || '<div class="empty-result">没有匹配的礼装</div>';
}

function renderOwnedCePicker() {
  if (!elements.ownedCeSearch || !elements.ownedCeList || !elements.ownedCeCount) return;
  const query = normalizeText(elements.ownedCeSearch.value);
  const filtered = catalog.bondCraftEssences.filter((ce) => (
    !query || normalizeText(ceSearchText(ce)).includes(query)
  ));
  const ownedCount = catalog.bondCraftEssences.filter((ce) => isCeOwned(ce.id)).length;
  elements.ownedCeCount.textContent = `持有 ${ownedCount} / ${catalog.bondCraftEssences.length} 张 · 显示 ${filtered.length} 张`;
  elements.ownedCeList.innerHTML = filtered.map((ce) => {
    const owned = isCeOwned(ce.id);
    const detail = `${ce.name} · ${parseBondEffect(ce, true).text || ce.description || "未识别效果"}`;
    const image = ce.avatar ? `<img src="${escapeHtml(ce.avatar)}" alt="" loading="lazy" />` : '<span class="ce-empty-mark" aria-hidden="true">礼</span>';
    return `<label class="owned-ce-tile ${owned ? "" : "is-unowned"}" title="${escapeHtml(detail)}"><input type="checkbox" data-owned-ce="${escapeHtml(ce.id)}" ${owned ? "checked" : ""} aria-label="持有 ${escapeHtml(ce.name)}" /><span class="owned-ce-image">${image}</span><span class="owned-ce-check" aria-hidden="true">✓</span></label>`;
  }).join("") || '<div class="empty-result">没有匹配的礼装</div>';
}

function openOwnedCePicker() {
  if (!catalog.bondCraftEssences.length) {
    dataStatus = "尚无礼装索引，请先同步数据";
    renderSummary();
    return;
  }
  elements.ownedCeSearch.value = "";
  renderOwnedCePicker();
  elements.ownedCeModal.showModal();
  elements.ownedCeSearch.focus();
}

let updatePrimaryAction = "close";
let updateVersion = "";

function setUpdateDialog({
  title,
  message,
  primaryLabel = "确定",
  primaryAction = "close",
  version = "",
  showSkip = false,
  laterLabel = "暂不更新",
  showLater = true,
}) {
  if (!elements.updateModal) return;
  updatePrimaryAction = primaryAction;
  updateVersion = version;
  elements.updateTitle.textContent = title;
  elements.updateMessage.textContent = message;
  elements.updatePrimary.textContent = primaryLabel;
  elements.updatePrimary.disabled = primaryAction === "waiting";
  elements.updateLater.textContent = laterLabel;
  elements.updateLater.classList.toggle("hidden", !showLater);
  elements.updateSkip.classList.toggle("hidden", !showSkip || !version);
  if (!elements.updateModal.open) elements.updateModal.showModal();
}

function updateNotesText(releaseNotes) {
  const notes = Array.isArray(releaseNotes) ? releaseNotes.map((note) => note?.note || note?.text || "").join(" ") : releaseNotes;
  return String(notes || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function formatUpdateMessage(payload = {}) {
  const version = String(payload.version || "").trim();
  const notes = updateNotesText(payload.releaseNotes);
  const releaseDate = new Date(payload.releaseDate || "");
  const dateText = Number.isNaN(releaseDate.getTime()) ? "" : `（发布于 ${releaseDate.toLocaleDateString("zh-CN")}）`;
  return `发现新版本${version ? ` v${version}` : ""}${dateText}。${notes ? ` ${notes}` : ""}`;
}

function formatDataSize(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** index);
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatDownloadProgress(payload = {}) {
  const percent = Math.min(100, Math.max(0, Number(payload.percent || 0)));
  const transferred = Number(payload.transferred || 0);
  const total = Number(payload.total || 0);
  const speed = Number(payload.bytesPerSecond || 0);
  const amount = total > 0 ? `${formatDataSize(transferred)} / ${formatDataSize(total)}` : formatDataSize(transferred);
  const speedText = speed > 0 ? `，${formatDataSize(speed)}/秒` : "";
  return `${percent.toFixed(percent >= 10 ? 0 : 1)}%（${amount}${speedText}）`;
}

async function showToolPaths() {
  if (!window.fgoDesktop || !elements.toolPathsModal) return;
  const paths = await window.fgoDesktop.getToolPaths();
  elements.bbchannelPath.value = paths.bbchannelPath || "未设置";
  elements.emulatorPath.value = paths.emulatorPath || "未设置";
  if (!elements.toolPathsModal.open) elements.toolPathsModal.showModal();
}

function setupDesktopIntegration() {
  if (!window.fgoDesktop) return;
  document.body.classList.add("desktop-runtime");
  void window.fgoDesktop.getUpdateStatus().then((status) => {
    if (!status?.currentVersion || !elements.checkUpdates) return;
    const availability = status.configured ? "在线更新已配置" : "在线更新尚未配置";
    elements.checkUpdates.title = `当前版本 v${status.currentVersion}；${availability}`;
  });
  window.fgoDesktop.onUpdate((payload) => {
    if (!payload || typeof payload !== "object") return;
    if (payload.type === "checking") {
      if (payload.manual) setUpdateDialog({
        title: "检测更新",
        message: `正在检查更新（当前版本 v${payload.currentVersion || ""}）。`,
        primaryAction: "waiting",
        showLater: false,
      });
      return;
    }
    if (payload.type === "available") {
      setUpdateDialog({
        title: "发现新版本",
        message: formatUpdateMessage(payload),
        primaryLabel: "下载更新",
        primaryAction: "download",
        version: payload.version,
        showSkip: true,
      });
      return;
    }
    if (payload.type === "not-available") {
      setUpdateDialog({ title: "已是最新版本", message: `当前版本 v${payload.currentVersion || ""} 已是最新版本。`, showLater: false });
      return;
    }
    if (payload.type === "downloading") {
      const version = String(payload.version || updateVersion || "").trim();
      setUpdateDialog({
        title: "正在下载更新",
        message: `正在下载${version ? ` v${version}` : ""}：${formatDownloadProgress(payload)}。下载完成后可选择重启安装。`,
        primaryAction: "waiting",
        showLater: false,
      });
      return;
    }
    if (payload.type === "downloaded") {
      setUpdateDialog({
        title: "更新已下载",
        message: `v${payload.version || "新版本"} 已下载完成。点击“重启并安装”会关闭账本并启动安装程序；选择“下次退出安装”则会在正常退出时安装。`,
        primaryLabel: "重启并安装",
        primaryAction: "install",
        version: payload.version,
        laterLabel: "下次退出安装",
      });
      return;
    }
    if (payload.type === "installing") {
      setUpdateDialog({ title: "正在启动安装程序", message: "账本将关闭并开始安装更新，请稍候。", primaryAction: "waiting", showLater: false });
      return;
    }
    if (payload.type === "unconfigured") {
      setUpdateDialog({
        title: "未配置更新地址",
        message: `当前版本 v${payload.currentVersion || ""} 尚未配置在线更新服务。请从发布页下载新版安装包，或由发布者在安装包中配置 HTTPS 更新地址。`,
        showLater: false,
      });
      return;
    }
    if (payload.type === "unsupported") {
      setUpdateDialog({
        title: "当前运行方式不支持在线更新",
        message: `当前版本 v${payload.currentVersion || ""} 未运行在可更新的已打包桌面版中。请使用 Windows 安装包安装后再检测更新。`,
        showLater: false,
      });
      return;
    }
    if (payload.type === "error") {
      const title = payload.stage === "download" ? "下载更新失败" : payload.stage === "install" ? "启动安装失败" : "检测更新失败";
      setUpdateDialog({ title, message: payload.message || "无法完成更新操作，请稍后重试。", showLater: false });
    }
  });
}

function openServantPicker(index) {
  if (!catalog.servants.length) {
    dataStatus = "尚无从者索引，请先同步数据";
    renderSummary();
    return;
  }
  activeServantSlot = index;
  elements.servantSearch.value = "";
  const availableClasses = [...new Set(catalog.servants.filter(grandPickerAllows).map((servant) => servant.className).filter(Boolean))].sort();
  elements.servantClassFilter.innerHTML = `<option value="">全部职阶</option>${availableClasses.map((className) => `<option value="${escapeHtml(className)}">${escapeHtml(labelForClass(className))}</option>`).join("")}`;
  elements.servantClassFilter.value = state.mode === "grand" && state.grandClass !== "Extra" ? state.grandClass : "";
  elements.servantStarFilter.value = "";
  renderServantPicker();
  elements.servantModal.showModal();
  elements.servantSearch.focus();
}

function openCePicker(index, kind = "regular", extraIndex = null) {
  if (!catalog.bondCraftEssences.length) {
    dataStatus = "尚无礼装索引，请先同步数据";
    renderSummary();
    return;
  }
  activeCeTarget = { index, kind, extraIndex };
  elements.ceSearch.value = "";
  renderCePicker();
  elements.ceModal.showModal();
  elements.ceSearch.focus();
}

function recordBattles() {
  const count = Math.max(1, Math.floor(numberOr(state.battleCount, 1)));
  const bonuses = calculateSlotBonuses();
  const friendIndex = getFriendIndex();
  const teaPotsBefore = getActiveTeaPotCount();
  // 占星茶壶以战斗为单位作用于全队，不能按五名本方从者分别扣除。
  const teaPotBattlesForRecord = Math.min(count, teaPotsBefore);
  const before = clone({ ...state, history: [], logs: [] });
  const notes = [];
  let recordableSlots = 0;
  state.slots.forEach((slot, index) => {
    if (index === friendIndex || !slot.servantId) return;
    const profile = getProfile(slot);
    if (!isGrandCompatible(profile)) {
      notes.push(`位置 ${index + 1} 未记入：不符合冠位编队条件`);
      return;
    }
    if (!hasCompleteProfile(profile)) {
      notes.push(`位置 ${index + 1} 未记入：羁绊数据尚未完成`);
      return;
    }
    recordableSlots += 1;
    const result = applyBattles(
      { ...slot, profile },
      getContextForSlot(index, bonuses, teaPotBattlesForRecord),
      count,
    );
    state.slots[index] = {
      ...state.slots[index],
      level: result.slot.level,
      progress: result.slot.progress,
      unlockedLevel: result.slot.unlockedLevel,
      awaitingUnlock: Boolean(result.slot.awaitingUnlock),
    };
    const name = profile.name || getServant(slot)?.name || `位置 ${index + 1}`;
    let note = `${name}：记入 ${result.battlesApplied}/${count} 场`;
    if (result.rewards.length) note += `，达到 ${result.rewards.map((entry) => `Lv.${entry.level}`).join("、")}`;
    if (result.stoppedReason) note += `；${result.stoppedReason}`;
    notes.push(note);
  });
  if (recordableSlots > 0 && teaPotBattlesForRecord > 0) {
    state.teaPotCount = teaPotsBefore - teaPotBattlesForRecord;
    notes.unshift(`占星茶壶：消耗 ${teaPotBattlesForRecord} 个，剩余 ${state.teaPotCount} 个`);
  } else if (recordableSlots === 0) {
    notes.push("未找到可记入的本方从者，未消耗占星茶壶");
  }
  state.history.unshift(before);
  state.history = state.history.slice(0, 8);
  state.logs.unshift(...notes);
  state.logs = state.logs.slice(0, 8);
  render();
}

function undoBattles() {
  const previous = state.history.shift();
  if (!previous) return;
  const history = state.history;
  state = normalizeState({ ...previous, history, logs: ["已撤销上次记入", ...(previous.logs || [])] });
  render();
}

async function syncData() {
  const button = document.querySelector("#sync-data");
  button.disabled = true;
  dataStatus = "正在从 Mooncell 同步";
  renderSummary();
  try {
    const live = await fetchLiveCatalog();
    catalog = mergeCatalog(catalog, live);
    refreshMaps();
    recommendation = null;
    recommendationSignature = "";
    try {
      localStorage.setItem(LIVE_CATALOG_KEY, JSON.stringify({ servants: live.servants, bondCraftEssences: live.bondCraftEssences, grandBattles: live.grandBattles, syncedAt: live.syncedAt, source: live.source }));
    } catch {
      dataStatus = "数据已同步，但索引未能写入本地缓存";
    }
    dataStatus = `Mooncell 已同步 ${catalog.servants.length} 骑从者`;
  } catch (error) {
    dataStatus = error instanceof Error ? error.message : "Mooncell 同步失败";
  } finally {
    button.disabled = false;
    render();
  }
}

function exportState() {
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    state: { ...state, history: [] },
    unownedCeIds: [...unownedCeIds].sort(),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `fgo-bond-ledger-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function finishBbchannelExportOptions(value) {
  const resolver = bbchannelExportOptionsResolver;
  bbchannelExportOptionsResolver = null;
  if (elements.bbchannelAssistModeModal?.open) elements.bbchannelAssistModeModal.close();
  if (resolver) resolver(value);
}

function chooseBbchannelExportOptions() {
  const assistMode = getDefaultBbchannelAssistMode(state.mode);
  const requirements = getDefaultBbchannelFriendRequirements(state.mode);
  if (!elements.bbchannelAssistModeModal || !elements.bbchannelAssistMode) {
    return Promise.resolve({ assistMode, ...requirements });
  }
  elements.bbchannelAssistMode.innerHTML = BBC_ASSIST_MODES
    .map((mode) => '<option value="' + escapeHtml(mode) + '">' + escapeHtml(mode) + '</option>')
    .join("");
  elements.bbchannelAssistMode.value = assistMode;
  if (elements.bbchannelNpLevel) elements.bbchannelNpLevel.value = String(requirements.npLevel);
  if (elements.bbchannelServantLevel) {
    elements.bbchannelServantLevel.value = requirements.servantLevel === null ? "" : String(requirements.servantLevel);
  }
  if (elements.bbchannelAssistModeHint) {
    elements.bbchannelAssistModeHint.textContent = state.mode === "grand"
      ? "当前为冠位模式，默认“冠位助战”、好友宝5、Lv.120；可按实际需求调整。"
      : "当前为普通模式，默认“从者礼装”、好友宝1，且不限定好友从者等级。";
  }
  return new Promise((resolve) => {
    if (bbchannelExportOptionsResolver) finishBbchannelExportOptions(null);
    bbchannelExportOptionsResolver = resolve;
    elements.bbchannelAssistModeModal.showModal();
  });
}
async function exportBbchannelTeam() {
  if (!window.fgoDesktop?.exportBbchannelTeamConfig) {
    dataStatus = "BBchannel 队伍配置导出仅在桌面版中可用";
    renderSummary();
    return;
  }
  try {
    const exportOptions = await chooseBbchannelExportOptions();
    if (!exportOptions) return;
    const config = createBbchannelTeamConfig({
      slots: state.slots,
      friendPosition: state.friendPosition,
      getServant,
      masterEquip: state.masterEquip,
      ...exportOptions,
    });
    const result = await window.fgoDesktop.exportBbchannelTeamConfig(config);
    if (result?.ok) {
      dataStatus = `已导出 BBchannel 队伍配置：${result.path}`;
    } else if (!result?.cancelled) {
      dataStatus = result?.message || "导出 BBchannel 队伍配置失败";
    }
  } catch (error) {
    dataStatus = error instanceof BbchannelExportError
      ? error.message
      : "导出 BBchannel 队伍配置失败";
  }
  renderSummary();
}

async function importState(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    state = normalizeState(parsed.state || parsed);
    if (Array.isArray(parsed.unownedCeIds)) {
      unownedCeIds = new Set(parsed.unownedCeIds.map((id) => String(id)));
      persistUnownedCes();
    }
    state.logs.unshift("已导入编队配置");
    render();
  } catch {
    dataStatus = "导入失败：文件格式不正确";
    renderSummary();
  }
}

function clearRoster() {
  if (!window.confirm("清空六个位置的从者与礼装配置？")) return;
  state.slots = Array.from({ length: 6 }, (_, index) => defaultSlot(index + 1));
  state.grandOwnPosition = 0;
  state.friendGrandServant = false;
  state.logs.unshift("已清空编队");
  render();
}

function swapSlots(fromIndex, toIndex) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return;
  if (fromIndex < 0 || fromIndex >= state.slots.length || toIndex < 0 || toIndex >= state.slots.length) return;
  const fromSlot = state.slots[fromIndex];
  state.slots[fromIndex] = { ...state.slots[toIndex], position: fromIndex + 1 };
  state.slots[toIndex] = { ...fromSlot, position: toIndex + 1 };
  recommendation = null;
  recommendationSignature = "";
  dataStatus = `已交换位置 ${fromIndex + 1} 与 ${toIndex + 1}`;
  render();
}

function moveFriendPosition(targetIndex) {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= state.slots.length) return;
  const nextPosition = targetIndex + 1;
  if (Number(state.friendPosition) === nextPosition) return;
  state.friendPosition = nextPosition;
  if (Number(state.grandOwnPosition) === nextPosition) state.grandOwnPosition = 0;
  recommendation = null;
  recommendationSignature = "";
  dataStatus = `已将好友位移动至位置 ${nextPosition}`;
  render();
}

function getCeDragTarget(node) {
  const target = node instanceof Element ? node.closest("[data-ce-drop-target]") : null;
  if (!target) return null;
  const index = Number(target.dataset.ceSlotIndex);
  const kind = target.dataset.ceKind;
  const extraIndex = Number(target.dataset.extraIndex);
  if (!Number.isInteger(index) || index < 0 || index >= state.slots.length) return null;
  if (kind !== "regular" && kind !== "grand") return null;
  if (kind === "grand" && (!Number.isInteger(extraIndex) || extraIndex < 0 || extraIndex >= GRAND_CE_SLOTS)) return null;
  return { index, kind, extraIndex: kind === "grand" ? extraIndex : null };
}

function sameCeDragTarget(left, right) {
  return left?.index === right?.index
    && left?.kind === right?.kind
    && left?.extraIndex === right?.extraIndex;
}

function readCeAssignment(target) {
  const slot = state.slots[target?.index];
  if (!slot) return null;
  if (target.kind === "grand") {
    return {
      ceId: String(slot.grandCeIds?.[target.extraIndex] || ""),
      mlb: slot.grandCeMlbs?.[target.extraIndex] !== false,
    };
  }
  return { ceId: String(slot.ceId || ""), mlb: slot.ceMlb !== false };
}

function writeCeAssignment(target, assignment) {
  const slot = state.slots[target?.index];
  if (!slot || !assignment) return;
  if (target.kind === "grand") {
    slot.grandCeIds[target.extraIndex] = String(assignment.ceId || "");
    slot.grandCeMlbs[target.extraIndex] = assignment.mlb !== false;
    return;
  }
  slot.ceId = String(assignment.ceId || "");
  slot.ceMlb = assignment.mlb !== false;
}

function swapCraftEssences(source, target) {
  if (!source || !target || source.kind !== target.kind || sameCeDragTarget(source, target)) return;
  const sourceAssignment = readCeAssignment(source);
  const targetAssignment = readCeAssignment(target);
  if (!sourceAssignment || !targetAssignment || !sourceAssignment.ceId) return;
  writeCeAssignment(source, targetAssignment);
  writeCeAssignment(target, sourceAssignment);
  normalizeActiveOwnCeSelections();
  recommendation = null;
  recommendationSignature = "";
  dataStatus = "已交换礼装位置";
  render();
}

document.addEventListener("click", (event) => {
  const mode = event.target.closest("[data-mode]");
  if (mode) {
    state.mode = mode.dataset.mode;
    render();
    return;
  }
  const close = event.target.closest("[data-close-modal]");
  if (close) {
    document.querySelector(`#${close.dataset.closeModal}`)?.close();
    return;
  }
  const slotNode = event.target.closest("[data-slot]");
  if (slotNode) {
    const index = Number(slotNode.dataset.slot);
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "pick-servant") openServantPicker(index);
    if (action === "pick-ce") openCePicker(index);
    if (action === "pick-grand-ce") openCePicker(index, "grand", Number(event.target.closest("[data-extra-index]")?.dataset.extraIndex));
    if (action === "clear-ce") {
      state.slots[index].ceId = "";
      render();
    }
    if (action === "clear-grand-ce") {
      const extraIndex = Number(event.target.closest("[data-extra-index]")?.dataset.extraIndex);
      if (Number.isInteger(extraIndex) && extraIndex >= 0 && extraIndex < GRAND_CE_SLOTS) state.slots[index].grandCeIds[extraIndex] = "";
      render();
    }
  }
  const servantChoice = event.target.closest("[data-select-servant]");
  if (servantChoice && activeServantSlot !== null) {
    const servant = servantMap.get(String(servantChoice.dataset.selectServant));
    if (!servant || !grandPickerAllows(servant)) return;
    const currentSlot = state.slots[activeServantSlot];
    if (!currentSlot) return;
    const equipment = {
      ceId: String(currentSlot.ceId || ""),
      ceMlb: currentSlot.ceMlb !== false,
      grandCeIds: Array.from({ length: GRAND_CE_SLOTS }, (_, extraIndex) => String(currentSlot.grandCeIds?.[extraIndex] || "")),
      grandCeMlbs: Array.from({ length: GRAND_CE_SLOTS }, (_, extraIndex) => currentSlot.grandCeMlbs?.[extraIndex] !== false),
    };
    Object.assign(currentSlot, defaultSlot(activeServantSlot + 1), equipment, { servantId: servant.id });
    elements.servantModal.close();
    const id = servant.id;
    activeServantSlot = null;
    render();
    void ensureProfile(id);
  }
  const ceChoice = event.target.closest("[data-select-ce]");
  if (ceChoice && activeCeTarget !== null) {
    const slot = state.slots[activeCeTarget.index];
    if (!slot || !canUseCeAtTarget(ceChoice.dataset.selectCe)) return;
    if (activeCeTarget.kind === "grand" && Number.isInteger(activeCeTarget.extraIndex)) {
      slot.grandCeIds[activeCeTarget.extraIndex] = ceChoice.dataset.selectCe;
      slot.grandCeMlbs[activeCeTarget.extraIndex] = true;
    } else {
      slot.ceId = ceChoice.dataset.selectCe;
      slot.ceMlb = true;
    }
    elements.ceModal.close();
    activeCeTarget = null;
    render();
  }
});

function getServantPickerNode(target) {
  return target instanceof Element ? target.closest(".servant-picker") : null;
}

function getFriendDropNode(target) {
  return target instanceof Element ? target.closest("[data-friend-drop-target]") : null;
}

document.addEventListener("dragstart", (event) => {
  const ceSource = event.target instanceof Element ? event.target.closest("[data-ce-drag-source]") : null;
  if (ceSource) {
    const source = getCeDragTarget(ceSource);
    if (!source || !readCeAssignment(source)?.ceId) return;
    draggedCe = source;
    event.dataTransfer?.setData("text/plain", `ce:${source.index}:${source.kind}:${source.extraIndex ?? ""}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    ceSource.classList.add("is-dragging");
    return;
  }
  const friendSource = event.target instanceof Element ? event.target.closest("[data-friend-drag-source]") : null;
  if (friendSource) {
    const slotNode = friendSource.closest(".slot-card[data-slot]");
    const sourceIndex = Number(slotNode?.dataset.slot);
    if (!Number.isInteger(sourceIndex) || sourceIndex !== getFriendIndex()) return;
    draggedFriendIndex = sourceIndex;
    event.dataTransfer?.setData("text/plain", `friend:${sourceIndex}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    friendSource.classList.add("is-dragging");
    return;
  }
  const picker = getServantPickerNode(event.target);
  const slotNode = picker?.closest(".slot-card[data-slot]");
  if (picker) {
    if (!picker.draggable || !slotNode) return;
    draggedSlotIndex = Number(slotNode.dataset.slot);
    if (!Number.isInteger(draggedSlotIndex)) return;
    event.dataTransfer?.setData("text/plain", String(draggedSlotIndex));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    picker.classList.add("is-dragging");
    return;
  }

  // 好友位的拖动面扩展到整张好友卡片，但从者区域和礼装区域保留各自的拖放行为。
  const friendSlotNode = event.target instanceof Element
    ? event.target.closest('.slot-card[data-slot][draggable="true"]')
    : null;
  const friendSlotIndex = Number(friendSlotNode?.dataset.slot);
  if (!friendSlotNode || !Number.isInteger(friendSlotIndex) || friendSlotIndex !== getFriendIndex()) return;
  if (event.target instanceof Element && event.target.closest(".servant-picker, .equipment-item")) return;
  draggedFriendIndex = friendSlotIndex;
  event.dataTransfer?.setData("text/plain", `friend:${friendSlotIndex}`);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  friendSlotNode.classList.add("is-dragging");
});

document.addEventListener("dragover", (event) => {
  if (draggedCe) {
    const target = getCeDragTarget(event.target);
    if (!target || target.kind !== draggedCe.kind || sameCeDragTarget(draggedCe, target)) return;
    event.preventDefault();
    const targetNode = event.target instanceof Element ? event.target.closest("[data-ce-drop-target]") : null;
    targetNode?.classList.add("drag-over");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    return;
  }
  if (Number.isInteger(draggedFriendIndex)) {
    const targetNode = getFriendDropNode(event.target);
    const targetIndex = Number(targetNode?.dataset.slot);
    if (!targetNode || !Number.isInteger(targetIndex) || targetIndex === draggedFriendIndex) return;
    event.preventDefault();
    targetNode.classList.add("friend-drag-over");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    return;
  }
  const picker = getServantPickerNode(event.target);
  const slotNode = picker?.closest(".slot-card[data-slot]");
  const targetIndex = Number(slotNode?.dataset.slot);
  if (!picker || !slotNode || !Number.isInteger(draggedSlotIndex) || draggedSlotIndex === targetIndex) return;
  event.preventDefault();
  picker.classList.add("drag-over");
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
});

document.addEventListener("dragleave", (event) => {
  const ceTarget = event.target instanceof Element ? event.target.closest("[data-ce-drop-target]") : null;
  if (ceTarget && !ceTarget.contains(event.relatedTarget)) ceTarget.classList.remove("drag-over");
  const friendTarget = getFriendDropNode(event.target);
  if (friendTarget && !friendTarget.contains(event.relatedTarget)) friendTarget.classList.remove("friend-drag-over");
  const picker = getServantPickerNode(event.target);
  if (!picker || picker.contains(event.relatedTarget)) return;
  picker.classList.remove("drag-over");
});

document.addEventListener("drop", (event) => {
  if (draggedCe) {
    const target = getCeDragTarget(event.target);
    if (!target || target.kind !== draggedCe.kind || sameCeDragTarget(draggedCe, target)) return;
    event.preventDefault();
    const source = draggedCe;
    draggedCe = null;
    document.querySelectorAll("[data-ce-drop-target].drag-over, [data-ce-drag-source].is-dragging").forEach((node) => node.classList.remove("drag-over", "is-dragging"));
    swapCraftEssences(source, target);
    return;
  }
  if (Number.isInteger(draggedFriendIndex)) {
    const targetNode = getFriendDropNode(event.target);
    const targetIndex = Number(targetNode?.dataset.slot);
    if (!targetNode || !Number.isInteger(targetIndex)) return;
    event.preventDefault();
    draggedFriendIndex = null;
    document.querySelectorAll("[data-friend-drop-target].friend-drag-over, [data-friend-drag-source].is-dragging, .slot-card.is-dragging").forEach((node) => node.classList.remove("friend-drag-over", "is-dragging"));
    moveFriendPosition(targetIndex);
    return;
  }
  const picker = getServantPickerNode(event.target);
  const slotNode = picker?.closest(".slot-card[data-slot]");
  const targetIndex = Number(slotNode?.dataset.slot);
  if (!picker || !slotNode || !Number.isInteger(draggedSlotIndex) || !Number.isInteger(targetIndex)) return;
  event.preventDefault();
  const fromIndex = draggedSlotIndex;
  draggedSlotIndex = null;
  document.querySelectorAll(".servant-picker.drag-over, .servant-picker.is-dragging").forEach((node) => node.classList.remove("drag-over", "is-dragging"));
  swapSlots(fromIndex, targetIndex);
});

document.addEventListener("dragend", () => {
  draggedSlotIndex = null;
  draggedFriendIndex = null;
  draggedCe = null;
  document.querySelectorAll(".servant-picker.drag-over, .servant-picker.is-dragging").forEach((node) => node.classList.remove("drag-over", "is-dragging"));
  document.querySelectorAll("[data-ce-drop-target].drag-over, [data-ce-drag-source].is-dragging, [data-friend-drop-target].friend-drag-over, [data-friend-drag-source].is-dragging, .slot-card.is-dragging").forEach((node) => node.classList.remove("drag-over", "friend-drag-over", "is-dragging"));
});

document.addEventListener("change", (event) => {
  const ownedCe = event.target.closest("[data-owned-ce]");
  if (ownedCe) {
    setCeOwned(ownedCe.dataset.ownedCe, ownedCe.checked);
    return;
  }
  const grandRole = event.target.closest("[data-grand-role]");
  if (grandRole) {
    const slot = grandRole.closest("[data-slot]");
    if (!slot) return;
    const index = Number(slot.dataset.slot);
    if (grandRole.dataset.grandRole === "friend") state.friendGrandServant = grandRole.checked;
    else state.grandOwnPosition = grandRole.checked ? index + 1 : (Number(state.grandOwnPosition) === index + 1 ? 0 : state.grandOwnPosition);
    render();
    return;
  }
  const grandMlb = event.target.closest("[data-grand-ce-mlb]");
  if (grandMlb) {
    const slot = grandMlb.closest("[data-slot]");
    const extraIndex = Number(grandMlb.dataset.grandCeMlb);
    if (!slot || !Number.isInteger(extraIndex) || extraIndex < 0 || extraIndex >= GRAND_CE_SLOTS) return;
    state.slots[Number(slot.dataset.slot)].grandCeMlbs[extraIndex] = grandMlb.checked;
    render();
    return;
  }
  const field = event.target.closest("[data-slot-field]");
  if (field) {
    const slot = field.closest("[data-slot]");
    if (!slot) return;
    setSlotField(Number(slot.dataset.slot), field.dataset.slotField, field.type === "checkbox" ? field.checked : field.value);
    render();
    return;
  }
  const target = event.target;
  if (target === elements.normalBaseBond) state.normalBaseBond = numberOr(target.value);
  if (target === elements.grandClass) {
    state.grandClass = target.value;
    state.grandBattleId = "";
  }
  if (target === elements.grandBattle) state.grandBattleId = target.value;
  if (target === elements.masterEquip) state.masterEquip = normalizeBbchannelMasterEquip(target.value);
  if (target === elements.friendPosition) {
    state.friendPosition = numberOr(target.value, 3);
    if (Number(state.grandOwnPosition) === Number(state.friendPosition)) state.grandOwnPosition = 0;
  }
  if (target === elements.costCap) state.costCap = numberOr(target.value);
  if (target === elements.teaPotEnabled) state.teaPotEnabled = target.checked;
  if (target === elements.teaPotCount) state.teaPotCount = normalizeTeaPotCount(target.value);
  if (target === elements.partyBonus) state.partyBonus = numberOr(target.value);
  if (target === elements.bonusCap) state.bonusCap = numberOr(target.value, 500);
  if (target === elements.battleCount) state.battleCount = Math.max(1, Math.floor(numberOr(target.value, 1)));
  if (target === elements.savedLineups) {
    selectedLineupName = target.value;
    lineupNameDraft = target.value;
  }
  if (target === document.querySelector("#import-state")) void importState(target.files?.[0]);
  render();
});

elements.servantSearch.addEventListener("input", renderServantPicker);
elements.servantClassFilter.addEventListener("change", renderServantPicker);
elements.servantStarFilter.addEventListener("change", renderServantPicker);
elements.ceSearch.addEventListener("input", renderCePicker);
elements.ownedCeSearch.addEventListener("input", renderOwnedCePicker);
elements.lineupName.addEventListener("input", () => { lineupNameDraft = elements.lineupName.value; });
elements.openOwnedCes.addEventListener("click", openOwnedCePicker);
elements.checkUpdates.addEventListener("click", () => {
  if (!window.fgoDesktop) return;
  setUpdateDialog({ title: "检测更新", message: "正在检查更新。", primaryAction: "waiting" });
  void window.fgoDesktop.checkForUpdates({ manual: true });
});
elements.updatePrimary.addEventListener("click", () => {
  if (updatePrimaryAction === "close") {
    elements.updateModal.close();
    return;
  }
  if (updatePrimaryAction === "download" && window.fgoDesktop) {
    setUpdateDialog({ title: "正在下载更新", message: "正在准备下载更新。", primaryAction: "waiting", showLater: false });
    void window.fgoDesktop.downloadUpdate();
    return;
  }
  if (updatePrimaryAction === "install" && window.fgoDesktop) {
    setUpdateDialog({ title: "正在启动安装程序", message: "账本将关闭并开始安装更新，请稍候。", primaryAction: "waiting", showLater: false });
    void window.fgoDesktop.installDownloadedUpdate();
  }
});
elements.updateSkip.addEventListener("click", () => {
  if (window.fgoDesktop && updateVersion) void window.fgoDesktop.skipUpdate(updateVersion);
  elements.updateModal.close();
});
elements.openToolPaths.addEventListener("click", () => void showToolPaths());
elements.openBbchannel.addEventListener("click", async () => {
  if (!window.fgoDesktop) return;
  const result = await window.fgoDesktop.openTool("bbchannel");
  if (!result?.ok) {
    dataStatus = result?.message || "无法打开 BBchannel，请先设置路径";
    renderSummary();
  }
});
elements.exportBbchannelTeam.addEventListener("click", () => void exportBbchannelTeam());
elements.bbchannelAssistModeConfirm?.addEventListener("click", () => {
  finishBbchannelExportOptions({
    assistMode: elements.bbchannelAssistMode?.value || null,
    npLevel: elements.bbchannelNpLevel?.value,
    servantLevel: elements.bbchannelServantLevel?.value,
  });
});
elements.bbchannelAssistModeCancel?.addEventListener("click", () => finishBbchannelExportOptions(null));
elements.bbchannelAssistModeModal?.addEventListener("cancel", (event) => {
  event.preventDefault();
  finishBbchannelExportOptions(null);
});
elements.bbchannelAssistModeModal?.addEventListener("close", () => {
  if (bbchannelExportOptionsResolver) finishBbchannelExportOptions(null);
});
elements.openEmulator.addEventListener("click", async () => {
  if (!window.fgoDesktop) return;
  const result = await window.fgoDesktop.openTool("emulator");
  if (!result?.ok) {
    dataStatus = result?.message || "无法打开模拟器，请先设置路径";
    renderSummary();
  }
});
document.querySelectorAll("[data-choose-tool-path]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!window.fgoDesktop) return;
    const result = await window.fgoDesktop.chooseToolPath(button.dataset.chooseToolPath);
    if (result?.ok) await showToolPaths();
  });
});
document.querySelector("#sync-data").addEventListener("click", () => void syncData());
document.querySelector("#export-state").addEventListener("click", exportState);
document.querySelector("#apply-battles").addEventListener("click", recordBattles);
document.querySelector("#undo-battles").addEventListener("click", undoBattles);
document.querySelector("#clear-roster").addEventListener("click", clearRoster);
document.querySelector("#recommend-ces").addEventListener("click", recommendCraftEssences);
elements.applyRecommendation.addEventListener("click", applyRecommendation);
document.querySelector("#save-lineup").addEventListener("click", saveLineup);
document.querySelector("#load-lineup").addEventListener("click", loadLineup);
document.querySelector("#delete-lineup").addEventListener("click", deleteLineup);

setupDesktopIntegration();
render();


