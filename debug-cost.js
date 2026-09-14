// 直接访问 state 和数据映射
const servantMap = new Map(servants.map(s => [String(s.id), s]));
const ceMap = new Map(ces.map(c => [String(c.id), c]));

state.slots.forEach((slot, i) => {
  const servant = servantMap.get(String(slot.servantId));
  const ce = ceMap.get(String(slot.ceId));
  const isFriendSlot = i === (state.mode === 'grand' ? 5 : 6);
  const isGrandSlot = state.mode === 'grand' && (isFriendSlot ? state.friendGrandServant : state.myGrandServant);
  
  console.log(`位置${i+1}: ${servant?.name || '空'} (冠位:${isGrandSlot})`);
  console.log(`  从者Cost: ${servant?.cost || 0}`);
  console.log(`  常规礼装: ${ce?.name || '无'} Cost:${ce?.cost || 0}`);
  
  if (slot.grandCeIds?.length) {
    slot.grandCeIds.forEach((ceId, j) => {
      const gce = ceMap.get(String(ceId));
      console.log(`  冠位礼装${j+1}: ${gce?.name || '无'} Cost:${gce?.cost || 0}`);
    });
  }
  
  // 手动计算总 Cost
  let totalCost = 0;
  if (servant && (!isFriendSlot || state.countFriendCost)) {
    totalCost += servant.cost;
    if (isGrandSlot) {
      if (slot.grandCeIds?.length) {
        slot.grandCeIds.forEach(ceId => {
          const gce = ceMap.get(String(ceId));
          if (gce) totalCost += gce.cost;
        });
      }
    } else if (ce) {
      totalCost += ce.cost;
    }
  }
  console.log(`  计算总Cost: ${totalCost}`);
});

console.log(`\n总Cost显示: ${document.querySelector('.total-cost')?.textContent}`);