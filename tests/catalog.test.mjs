import assert from "node:assert/strict";
import test from "node:test";
import { calculateFormationSlotCost } from "../src/calculator.js";
import { mergeCatalog } from "../src/catalog.js";

test("同步缓存缺失礼装字段时会回填内置 Cost 与图标", () => {
  const merged = mergeCatalog({
    servants: [],
    bondCraftEssences: [{
      id: "ce-12",
      name: "内置礼装",
      description: "内置描述",
      cost: 12,
      avatar: "https://example.invalid/snapshot.jpg",
    }],
    grandBattles: [],
    profiles: {},
    source: "内置快照",
  }, {
    bondCraftEssences: [{
      id: "ce-12",
      name: "同步礼装",
      description: "同步描述",
    }],
    source: "同步索引",
  });

  const [ce] = merged.bondCraftEssences;
  assert.equal(ce.name, "同步礼装");
  assert.equal(ce.cost, 12);
  assert.equal(ce.avatar, "https://example.invalid/snapshot.jpg");
  assert.equal(calculateFormationSlotCost({ servantCost: 102, regularCeCost: ce.cost }), 114);
});

test("同步索引会保留新增项目且不丢失快照独有项目", () => {
  const merged = mergeCatalog({
    servants: [{ id: "snapshot-only", name: "快照从者" }],
    bondCraftEssences: [],
    grandBattles: [],
    profiles: { "snapshot-only": { cost: 3, bondPoints: [100] } },
  }, {
    servants: [{ id: "live-only", name: "同步从者" }],
    bondCraftEssences: [],
    grandBattles: [],
    profiles: { "snapshot-only": { className: "Saber" } },
  });

  assert.deepEqual(merged.servants.map((servant) => servant.id), ["live-only", "snapshot-only"]);
  assert.deepEqual(merged.profiles["snapshot-only"], { cost: 3, bondPoints: [100], className: "Saber" });
});
