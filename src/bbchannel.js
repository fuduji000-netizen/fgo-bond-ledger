/**
 * BBchannel 队伍档案（settings/*.json）的纯数据转换。
 *
 * 账本保存可选的御主礼装，并生成 BBC 可载入的队伍、助战、御主礼装和
 * 连接默认项；不写入或覆盖任何 BBchannel 现有配置。
 */

// Mooncell 与 BBC 中文从者名的已知差异。优先使用 ID，避免同名不同灵基误替换。
const BBC_SERVANT_ID_OVERRIDES = Object.freeze({
  "154": "山中老人",
  "284": "阿尔托莉雅·Caster",
  "356": "宇津见绘里濑(Avenger)",
  "410": "亚历山德罗·卡里奥斯特罗",
  "419": "多布雷尼娅·尼基季奇(Lancer)",
  "424": "岸波白野(男性)",
  "425": "岸波白野(女性)",
  "432": "理查Ⅰ世",
  "467": "弗朗索瓦·普勒拉蒂",
});

const BBC_SERVANT_NAME_OVERRIDES = Object.freeze({
  "“山中老人”": "山中老人",
  "阿尔托莉雅·卡斯特·Caster": "阿尔托莉雅·Caster",
  "亚历山德罗·迪·卡利奥斯特罗": "亚历山德罗·卡里奥斯特罗",
  "多布雷尼亚·尼基季奇": "多布雷尼娅·尼基季奇(Lancer)",
  "理查一世": "理查Ⅰ世",
  "宇津见绘里濑": "宇津见绘里濑(Avenger)",
});

const BBC_CONNECTION_DEFAULTS = Object.freeze({
  connectMode: "ADB方式",
  snapshotDevice: ["normal", "127.0.0.1:7555"],
  operateDevice: ["normal", "127.0.0.1:7555"],
  specialKeys: [],
  server: "CH",
});

/** BBchannel 支持的助战识别模式，值必须与 BBC 配置文件中的选项文本一致。 */
export const BBC_ASSIST_MODES = Object.freeze([
  "不识别",
  "仅礼装",
  "仅从者",
  "从者礼装",
  "冠位助战",
  "冠位助战&礼装",
]);

/**
 * BBchannel master_info.json 中的御主礼装编号。
 * SN 是 BBC 队伍配置 master_equip 使用的 0 起始序号。
 */
export const BBC_MASTER_EQUIPS = Object.freeze([
  { sn: 0, name: "2004年的碎片" },
  { sn: 1, name: "魔术礼装·阿特拉斯院制服" },
  { sn: 2, name: "第五真说要素环境用迦勒底制服" },
  { sn: 3, name: "金色庆典" },
  { sn: 4, name: "迦勒底船长" },
  { sn: 5, name: "迦勒底开拓者" },
  { sn: 6, name: "魔术礼装·迦勒底战斗服" },
  { sn: 7, name: "魔术礼装·迦勒底" },
  { sn: 8, name: "魔术礼装·极地用迦勒底制服" },
  { sn: 9, name: "魔术礼装·魔术协会制服" },
  { sn: 10, name: "热带夏日" },
  { sn: 11, name: "明亮夏日" },
  { sn: 12, name: "王室品牌" },
  { sn: 13, name: "华美的新年" },
  { sn: 14, name: "月之海的记忆" },
  { sn: 15, name: "月之背面的记忆" },
  { sn: 16, name: "万圣夜王室装" },
  { sn: 17, name: "决战用迦勒底制服" },
  { sn: 18, name: "总耶高校学生服" },
  { sn: 19, name: "新春装束" },
  { sn: 20, name: "夏日街头" },
  { sn: 21, name: "白色圣诞" },
  { sn: 22, name: "三咲高校学生服" },
  { sn: 23, name: "冬日便装" },
  { sn: 24, name: "浅葱的队服" },
  { sn: 25, name: "标准·迦勒底制服" },
  { sn: 26, name: "二十八怪物" },
]);

const BBC_MASTER_EQUIP_SNS = new Set(BBC_MASTER_EQUIPS.map(({ sn }) => sn));

/** 账本模式切换后，导出对话框默认采用的 BBC 识别模式。 */
export function getDefaultBbchannelAssistMode(ledgerMode = "normal") {
  return ledgerMode === "grand" ? "冠位助战" : "从者礼装";
}

/**
 * BBC 队伍档案中的好友筛选条件默认值。
 * 冠位助战常用满级、宝具五；普通模式默认宝具一且不限制从者等级。
 */
export function getDefaultBbchannelFriendRequirements(ledgerMode = "normal") {
  return ledgerMode === "grand"
    ? { npLevel: 5, servantLevel: 120 }
    : { npLevel: 1, servantLevel: null };
}

export function normalizeBbchannelAssistMode(value, fallback = "从者礼装") {
  const mode = nonEmptyText(value);
  if (mode && BBC_ASSIST_MODES.includes(mode)) return mode;
  return BBC_ASSIST_MODES.includes(fallback) ? fallback : "从者礼装";
}

/** BBC 的 master_equip 是 master_info.json 中的 SN 序号。 */
export function normalizeBbchannelMasterEquip(value, fallback = 0) {
  const normalizedFallback = BBC_MASTER_EQUIP_SNS.has(Math.trunc(Number(fallback)))
    ? Math.trunc(Number(fallback))
    : 0;
  const sn = Math.trunc(Number(value));
  return BBC_MASTER_EQUIP_SNS.has(sn) ? sn : normalizedFallback;
}

/** BBC 的 NPlevel 是好友宝具等级筛选，合法值为宝1–宝5。 */
export function normalizeBbchannelNpLevel(value, fallback = 1) {
  const normalizedFallback = Math.min(Math.max(Math.floor(Number(fallback) || 1), 1), 5);
  const level = Math.floor(Number(value));
  return level >= 1 && level <= 5 ? level : normalizedFallback;
}

/**
 * BBC 的 servantLevel 是好友从者等级筛选。空值表示不写入该条件；
 * 有效范围与游戏从者等级一致，为 Lv.1–Lv.120。
 */
export function normalizeBbchannelServantLevel(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const level = Math.floor(Number(value));
  return level >= 1 && level <= 120 ? level : null;
}

function nonEmptyText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function uniqueTexts(values) {
  return [...new Set(values.map(nonEmptyText).filter(Boolean))];
}

export class BbchannelExportError extends Error {
  constructor(message) {
    super(message);
    this.name = "BbchannelExportError";
  }
}

/** 返回 BBC 可识别的从者中文名；空位或未加载的从者返回 null。 */
export function resolveBbchannelServantName(servant) {
  if (!servant || typeof servant !== "object") return null;
  const byId = BBC_SERVANT_ID_OVERRIDES[String(servant.id || "")];
  if (byId) return byId;

  const candidates = uniqueTexts([
    servant.title,
    servant.name,
    ...(Array.isArray(servant.aliases) ? servant.aliases : []),
  ]);
  for (const candidate of candidates) {
    if (BBC_SERVANT_NAME_OVERRIDES[candidate]) return BBC_SERVANT_NAME_OVERRIDES[candidate];
  }
  return candidates[0] || null;
}

/**
 * 创建不带 page0/page1/page2 包装的 BBchannel 队伍档案。
 * 该档案可由 BBC 的“文件”菜单载入，不能也不会改写 scripts_settings.json。
 */
export function createBbchannelTeamConfig({
  slots,
  friendPosition,
  getServant,
  assistMode,
  npLevel,
  servantLevel,
  masterEquip,
} = {}) {
  const lineup = Array.isArray(slots) ? slots.slice(0, 6) : [];
  while (lineup.length < 6) lineup.push(null);
  const friendIndex = Math.trunc(Number(friendPosition)) - 1;

  if (friendIndex < 0 || friendIndex > 5) {
    throw new BbchannelExportError("好友位置必须在 1–6 之间，无法生成 BBchannel 助战配置。");
  }
  if (typeof getServant !== "function") {
    throw new BbchannelExportError("编队数据不完整，无法导出 BBchannel 队伍配置。");
  }

  const friendSlot = lineup[friendIndex];
  const friendServant = getServant(friendSlot);
  if (!resolveBbchannelServantName(friendServant)) {
    throw new BbchannelExportError("好友位尚未选择从者，无法生成 BBchannel 助战配置。");
  }
  const config = {};
  lineup.forEach((slot, index) => {
    config[`servant_${index}_name`] = resolveBbchannelServantName(getServant(slot));
  });

  // 仅保留助战所在位置；队伍配置不再写入任何礼装字段。
  config.assistIdx = friendIndex;
  config.assistMode = normalizeBbchannelAssistMode(assistMode);
  // BBC 的御主礼装由 master_info.json 的 SN 序号引用，不是礼装名称。
  config.master_equip = normalizeBbchannelMasterEquip(masterEquip);
  // 这两个字段是 BBC 的好友筛选参数，而不是我方从者的养成数据。
  config.NPlevel = normalizeBbchannelNpLevel(npLevel);
  const normalizedServantLevel = normalizeBbchannelServantLevel(servantLevel);
  if (normalizedServantLevel !== null) config.servantLevel = normalizedServantLevel;
  config.usedServant = lineup.slice(0, 3).flatMap((slot, index) => (
    index !== friendIndex && resolveBbchannelServantName(getServant(slot)) ? [index] : []
  ));
  Object.assign(config, BBC_CONNECTION_DEFAULTS);
  return config;
}
