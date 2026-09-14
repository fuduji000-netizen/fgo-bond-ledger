/**
 * BBchannel 队伍档案（settings/*.json）的纯数据转换。
 *
 * 账本没有保存御主礼装或战斗策略；因此只生成 BBC 可载入的队伍、助战和
 * 连接默认项，不写入或覆盖任何 BBchannel 现有配置。
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
export function createBbchannelTeamConfig({ slots, friendPosition, getServant } = {}) {
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
  config.usedServant = lineup.slice(0, 3).flatMap((slot, index) => (
    index !== friendIndex && resolveBbchannelServantName(getServant(slot)) ? [index] : []
  ));
  Object.assign(config, BBC_CONNECTION_DEFAULTS);
  return config;
}
