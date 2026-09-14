const WIKI_API = "https://fgo.wiki/api.php";
const WIKI_PAGE = "https://fgo.wiki/w/";
const ATLAS_SERVANT_API = "https://api.atlasacademy.io/nice/JP/servant/";
const EXTRA_I_CLASSES = ["Ruler", "Avenger", "MoonCancer", "Shielder"];
const EXTRA_II_CLASSES = ["Alterego", "Foreigner", "Pretender", "Beast"];
const EXTRA_CLASSES = [...EXTRA_I_CLASSES, ...EXTRA_II_CLASSES];

export const CLASS_NAMES = {
  Shielder: "盾阶",
  Saber: "剑阶",
  Archer: "弓阶",
  Lancer: "枪阶",
  Rider: "骑阶",
  Caster: "术阶",
  Assassin: "杀阶",
  Berserker: "狂阶",
  Ruler: "裁阶",
  Avenger: "仇阶",
  MoonCancer: "月癌",
  Alterego: "降临者",
  Foreigner: "降临者",
  Pretender: "伪阶",
  Beast: "兽阶",
  Unknown: "特殊",
};

const GRAND_CLASSES = ["Saber", "Archer", "Lancer", "Rider", "Caster", "Assassin", "Berserker", "Extra"];

export function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[\s·・、，,.'"“”‘’()（）\[\]〔〕【】_\-－—]/g, "");
}

function stripConditionAnnotations(value = "") {
  let cleaned = String(value);
  let previous = "";
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned.replace(/[（(][^()（）]*[)）]/g, "");
  }
  return cleaned;
}

/**
 * 将 Mooncell 礼装条件和从者资料中的同义写法归一。
 * 例如“拥有星之力的从者”实际对应副属性“星”。
 */
export function normalizeConditionRequirement(value = "") {
  const normalized = normalizeText(stripConditionAnnotations(value))
    .replace(/职阶|特性|从者|的/g, "");
  return normalized.replace(/^拥有([天地人星兽])之力$/, "$1");
}

export function wikiUrl(title) {
  return `${WIKI_PAGE}${encodeURIComponent(String(title || "").replace(/ /g, "_"))}`;
}

function imageUrl(value) {
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  return value;
}

function parseRecords(text) {
  return String(text || "")
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((block) => {
      const record = {};
      block.split(/\r?\n/).forEach((line) => {
        const index = line.indexOf("=");
        if (index > 0) {
          record[line.slice(0, index).trim()] = line.slice(index + 1).trim();
        }
      });
      return record;
    })
    .filter((record) => record.id);
}

function parseCsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/);
  const headers = (lines.shift() || "").split(",");
  return lines.map((line) => {
    const fields = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, fields[index] || ""]));
  });
}

function pick(record, key) {
  return String(record?.[key] || "").trim();
}

export function parseServantIndex(listText, coreText) {
  const coreById = new Map(parseCsv(coreText).map((record) => [pick(record, "id"), record]));

  return parseRecords(listText)
    .map((record) => {
      const core = coreById.get(pick(record, "id")) || {};
      const aliases = [
        pick(record, "name_cn"),
        pick(record, "name_jp"),
        pick(record, "name_en"),
        pick(record, "name_link"),
        ...pick(record, "name_other").split(/[&＆]/),
      ].filter(Boolean);
      const title = pick(record, "name_link") || pick(record, "name_cn");
      return {
        id: pick(record, "id"),
        name: pick(record, "name_cn") || title,
        title,
        aliases: [...new Set(aliases)],
        className: pick(core, "class_link"),
        star: Number(pick(core, "star")) || 0,
        cost: Number(pick(core, "cost")) || 0,
        avatar: imageUrl(pick(core, "avatar")),
        subAttribute: pick(core, "faction"),
        sourceUrl: wikiUrl(title),
      };
    })
    .filter((servant) => servant.name && servant.title)
    .sort((left, right) => Number(right.id) - Number(left.id));
}

function cleanWikiText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/{{[^{}]*}}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanGrandBattleName(value) {
  let name = String(value || "");
  const template = /\{\{[^{}|]+\|(?:[^{}|]*\|)*([^{}|]+)\}\}/g;
  let previous = "";
  while (name !== previous) {
    previous = name;
    name = name.replace(template, "$1");
  }
  name = cleanWikiText(name)
    .replace(/冠位解放戦/g, "冠位解放战")
    .replace(/冠位認定戦/g, "冠位认定战")
    .replace(/冠位研鑽戦/g, "冠位钻研战");
  return Object.entries({
    セイバー: "Saber",
    アーチャー: "Archer",
    ランサー: "Lancer",
    ライダー: "Rider",
    キャスター: "Caster",
    アサシン: "Assassin",
    バーサーカー: "Berserker",
    エクストラ: "Extra",
  }).reduce((result, [source, target]) => result.replaceAll(source, target), name);
}

function parseTemplateParameters(text, templateName) {
  const match = String(text || "").match(new RegExp(`\\{\\{${templateName}([\\s\\S]*?)\\n\\}\\}`));
  if (!match) return {};
  const parameters = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const found = line.match(/^\|([^=|]+)=(.*)$/);
    if (found) parameters[found[1].trim()] = cleanWikiText(found[2]);
  });
  return parameters;
}

export function parseServantProfile(text, fallback = {}) {
  const basic = parseTemplateParameters(text, "基础数值");
  const bondMatch = String(text || "").match(/\{\{牵绊点数\s*\|([^\n}]+)/);
  const bondPoints = bondMatch
    ? bondMatch[1].split("|").slice(0, 10).map((value) => Number(value.replace(/[^\d]/g, "")) || 0)
    : [];
  const traits = Object.entries(basic)
    .filter(([key]) => /^特性\d+$/.test(key))
    .map(([, value]) => value)
    .filter(Boolean);
  const attributes = [basic.属性1, basic.属性2].filter(Boolean);

  return {
    ...fallback,
    id: basic.从者内部id || fallback.id,
    name: basic.中文名 || fallback.name,
    className: basic.职阶 || fallback.className,
    star: Number(basic.稀有度) || fallback.star || 0,
    cost: Number(basic.COST) || fallback.cost || 0,
    attributes,
    subAttribute: basic.副属性 || fallback.subAttribute || "",
    gender: basic.性别 || fallback.gender || "",
    traits,
    nickname: basic.昵称 || "",
    bondPoints,
    bondSource: bondPoints.length === 10 ? "Mooncell" : "",
  };
}

export function bondGrowthToStageRequirements(bondGrowth) {
  let previous = 0;
  const requirements = (Array.isArray(bondGrowth) ? bondGrowth : [])
    .slice(0, 10)
    .map((value) => {
      const cumulative = Math.floor(Number(value));
      if (!Number.isFinite(cumulative) || cumulative <= previous) return 0;
      const requirement = cumulative - previous;
      previous = cumulative;
      return requirement;
    });
  return requirements.length === 10 && requirements.every((value) => value > 0) ? requirements : [];
}

export function parseBondCraftEssences(text, coreText = "") {
  const coreById = new Map(parseCsv(coreText).map((record) => [pick(record, "id"), record]));
  return parseRecords(text)
    .filter((record) => /[羁牵]绊/.test(`${pick(record, "des")} ${pick(record, "des_max")}`))
    .map((record) => {
      const core = coreById.get(pick(record, "id")) || {};
      return {
        id: pick(record, "id"),
        name: pick(record, "name"),
        title: pick(record, "name_link") || pick(record, "name"),
        // Mooncell 少数礼装只在数据表里写了日文名，页面标题才是中文名。
        // 保留原名用于校验，同时把中文名收进别名，保证中文搜索也能命中。
        aliases: [
          pick(record, "name_cn"),
          pick(record, "name_link_cn"),
          pick(record, "name_other"),
        ].filter(Boolean),
        star: Number(pick(record, "rare")) || Number(pick(core, "star")) || 0,
        cost: Number(pick(record, "cost")) || Number(pick(core, "cost")) || 0,
        description: cleanWikiText(pick(record, "des")),
        maxDescription: cleanWikiText(pick(record, "des_max")),
        avatar: imageUrl(pick(record, "avatar") || pick(core, "icon")),
        sourceUrl: wikiUrl(pick(record, "name_link") || pick(record, "name")),
      };
    })
    .filter((ce) => ce.name)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

export function parseBondEffect(ce, maxLimitBroken = true, { isSupport = false } = {}) {
  const text = maxLimitBroken && ce?.maxDescription ? ce.maxDescription : ce?.description || "";
  const amountMatches = [...text.matchAll(/(?:获得的[羁牵]绊(?:值|点数)?(?:增加)+|[羁牵]绊(?:值|点数)?获得量(?:提升)+)\s*(\d+(?:\.\d+)?)(%?)/g)];
  const percentageMatch = amountMatches.find((match) => match[2] === "%");
  const flatMatch = amountMatches.find((match) => match[2] !== "%");
  const basePercent = Number(percentageMatch?.[1]) || 0;
  const baseFlat = Number(flatMatch?.[1]) || 0;
  const supportMatch = text.match(/助战时(?:增加|提升)?\s*(\d+(?:\.\d+)?)%/);
  const supportPercent = Number(supportMatch?.[1]) || 0;
  const percent = isSupport && supportPercent > 0 ? supportPercent : basePercent;
  const beforeEffect = amountMatches[0] ? text.slice(0, amountMatches[0].index) : text;
  const brackets = [...beforeEffect.matchAll(/〔([^〕]+)〕/g)].map((match) => match[1]);
  // Mooncell 的羁绊礼装文案以“符合条件的从者”作为对象；只有明确写出“自身”时才是单体效果。
  const selfOnly = /(?:自身|自身的)/.test(beforeEffect);
  const condition = brackets.join("或");
  return {
    text,
    percent,
    basePercent,
    supportPercent,
    flat: baseFlat,
    target: selfOnly ? "self" : "party",
    condition,
    parsed: percent > 0 || baseFlat > 0,
  };
}

export function matchesCondition(profile, condition) {
  if (!condition) return true;
  const values = [
    profile?.className,
    profile?.subAttribute,
    profile?.gender,
    ...(profile?.attributes || []),
    ...(profile?.traits || []),
  ].filter(Boolean).map(normalizeConditionRequirement);
  const isSevenKnightClass = ["saber", "archer", "lancer", "rider", "caster", "assassin", "berserker"].includes(normalizeText(profile?.className));

  return stripConditionAnnotations(condition).split(/[或/／]/).some((alternative) => {
    const requirements = alternative.split(/[且・&＆]/).filter(Boolean);
    return requirements.every((rawRequirement) => {
      let requirement = normalizeConditionRequirement(rawRequirement);
      if (!requirement) return true;
      if (requirement.includes("七骑士")) {
        if (!isSevenKnightClass) return false;
        requirement = requirement.replace("七骑士", "");
      }
      if (requirement.includes("女性")) {
        if (normalizeText(profile?.gender) !== "女性") return false;
        requirement = requirement.replace("女性", "").replace(/的/g, "");
      }
      if (requirement.includes("男性")) {
        if (normalizeText(profile?.gender) !== "男性") return false;
        requirement = requirement.replace("男性", "").replace(/的/g, "");
      }
      if (/(持有灵衣之人|持有灵衣者|灵衣持有者|持有灵衣|灵衣)/.test(requirement)) {
        if (!profile?.hasCostume) return false;
        requirement = requirement
          .replace(/持有灵衣之人|持有灵衣者|灵衣持有者|持有灵衣|灵衣/g, "")
          .replace(/的/g, "");
      }
      if (!requirement) return true;
      return values.some((value) => value.includes(requirement) || requirement.includes(value));
    });
  });
}

export async function fetchWikiText(title) {
  const url = new URL(WIKI_API);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    titles: title,
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mooncell 请求失败：${response.status}`);
  const payload = await response.json();
  const page = payload?.query?.pages?.[0];
  const content = page?.revisions?.[0]?.slots?.main?.content;
  if (!content) throw new Error(`Mooncell 未返回页面内容：${title}`);
  return content;
}

export async function fetchAtlasBondPoints(collectionNo) {
  const response = await fetch(`${ATLAS_SERVANT_API}${encodeURIComponent(String(collectionNo))}`);
  if (!response.ok) throw new Error(`Atlas Academy 请求失败：${response.status}`);
  const payload = await response.json();
  return bondGrowthToStageRequirements(payload?.bondGrowth);
}

function parseGrandAllowedClasses(className, rule = "") {
  if (className !== "Extra") return className ? [className] : [];
  if (/extra\s*Ⅰ/i.test(String(rule))) return EXTRA_I_CLASSES;
  if (/extra\s*Ⅱ/i.test(String(rule))) return EXTRA_II_CLASSES;
  return EXTRA_CLASSES;
}

export function getGrandBattleAllowedClasses(battle) {
  const explicit = [...new Set((battle?.allowedClasses || []).filter(Boolean))];
  if (explicit.length) return explicit;
  return parseGrandAllowedClasses(battle?.className, battle?.name);
}

function parseGrandBattleText(text, className) {
  const quests = [];
  let heading = "";
  let section = "";
  let inConfig = false;
  let fields = {};

  const save = () => {
    const baseBond = Number(fields.牵绊);
    if (!Number.isFinite(baseBond) || baseBond <= 0) return;
    let name = cleanGrandBattleName(fields.名称cn)
      || cleanGrandBattleName(heading)
      || cleanGrandBattleName(fields.名称jp);
    if (!name) name = `冠位戴冠战：${className}（${quests.length + 1}）`;
    let id = `${className}:${name}:${baseBond}`;
    if (quests.some((quest) => quest.id === id)) {
      name = `${name}（${quests.length + 1}）`;
      id = `${className}:${name}:${baseBond}`;
    }
    quests.push({
      id,
      className,
      name,
      baseBond,
      allowedClasses: parseGrandAllowedClasses(className, fields.一杂项内容),
      section,
      sourceUrl: wikiUrl(`冠位戴冠战：${className}/关卡配置`),
    });
  };

  String(text || "").split(/\r?\n/).forEach((line) => {
    const levelTwo = line.match(/^==([^=]+)==$/);
    const levelThree = line.match(/^===([^=]+)===$/);
    if (levelTwo) section = cleanWikiText(levelTwo[1]);
    if (levelThree) heading = cleanWikiText(levelThree[1]);
    if (line.trim() === "{{关卡配置") {
      inConfig = true;
      fields = {};
      return;
    }
    if (inConfig && line.trim() === "}}") {
      save();
      inConfig = false;
      return;
    }
    if (inConfig) {
      const field = line.match(/^\|([^=]+)=(.*)$/);
      if (field) fields[field[1].trim()] = field[2].trim();
    }
  });
  return quests;
}

export async function fetchLiveCatalog() {
  const [servantIndex, servantCore, craftIndex, craftCore, ...grandPages] = await Promise.all([
    fetchWikiText("英灵图鉴/数据"),
    fetchWikiText("微件:ServantsList/core"),
    fetchWikiText("礼装图鉴/数据"),
    fetchWikiText("微件:CraftsList/core"),
    ...GRAND_CLASSES.map((className) => fetchWikiText(`冠位戴冠战：${className}/关卡配置`)),
  ]);
  return {
    servants: parseServantIndex(servantIndex, servantCore),
    bondCraftEssences: parseBondCraftEssences(craftIndex, craftCore),
    grandBattles: grandPages.flatMap((text, index) => parseGrandBattleText(text, GRAND_CLASSES[index])),
    syncedAt: new Date().toISOString(),
    source: "Mooncell",
  };
}
