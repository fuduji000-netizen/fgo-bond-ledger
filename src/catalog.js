function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function idOf(item) {
  const id = item?.id;
  return id === undefined || id === null || id === "" ? "" : String(id);
}

function usable(value) {
  return value !== undefined && value !== null && value !== "";
}

function mergeRecord(snapshotRecord, liveRecord) {
  const snapshot = asObject(snapshotRecord);
  const live = asObject(liveRecord);
  const merged = { ...snapshot, ...live };

  // 同步索引只提供部分字段时，不能抹掉内置快照中用于 Cost 与图标展示的字段。
  ["name", "avatar", "aliases", "description", "maxDescription", "star"].forEach((key) => {
    if (!usable(merged[key]) && usable(snapshot[key])) merged[key] = snapshot[key];
  });
  if (Number(snapshot.cost) > 0 && Number(merged.cost) <= 0) merged.cost = snapshot.cost;

  return merged;
}

function mergeIndexedList(snapshotItems, liveItems) {
  const snapshot = asList(snapshotItems);
  const live = asList(liveItems);
  if (!live.length) return snapshot;

  const snapshotById = new Map(snapshot.map((item) => [idOf(item), item]).filter(([id]) => id));
  const liveIds = new Set();
  const mergedLive = live.map((item) => {
    const id = idOf(item);
    if (id) liveIds.add(id);
    return id && snapshotById.has(id) ? mergeRecord(snapshotById.get(id), item) : item;
  });

  // 保留同步索引尚未收录的内置项目，避免旧缓存把当前可选项整体删掉。
  return [...mergedLive, ...snapshot.filter((item) => {
    const id = idOf(item);
    return !id || !liveIds.has(id);
  })];
}

function mergeProfiles(snapshotProfiles, liveProfiles) {
  const snapshot = asObject(snapshotProfiles);
  const live = asObject(liveProfiles);
  const keys = new Set([...Object.keys(snapshot), ...Object.keys(live)]);
  return Object.fromEntries([...keys].map((key) => [key, mergeRecord(snapshot[key], live[key])]));
}

export function mergeCatalog(snapshotCatalog, liveCatalog) {
  const snapshot = asObject(snapshotCatalog);
  const live = asObject(liveCatalog);
  return {
    servants: mergeIndexedList(snapshot.servants, live.servants),
    bondCraftEssences: mergeIndexedList(snapshot.bondCraftEssences, live.bondCraftEssences),
    grandBattles: mergeIndexedList(snapshot.grandBattles, live.grandBattles),
    profiles: mergeProfiles(snapshot.profiles, live.profiles),
    syncedAt: live.syncedAt || snapshot.syncedAt || "",
    source: live.source || snapshot.source || "Mooncell",
  };
}
