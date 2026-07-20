const KITCHEN_SPACES = [
  "Kitchen", "Dry Kitchen", "Wet Kitchen", "Wet Kitchen & Laundry"
];

const BATHROOM_SPACES = [
  "Common Bathroom", "Guest Bathroom", "Guest Bath 2",
  "Master Bathroom", "Kids Bathroom"
];

const FLOOR_WORKS = ["Sweep", "Mop", "Dry Mop", "Floor Wash", "Floor Wash + Wipe"];

const WORK_TYPE_ORDER = [
  "Dusting", "Dusting + Arrange", "Fluff", "Arrange", "Light Clean",
  "Clean", "Clean + Arrange", "Clean + Wipe", "Clean + Empty",
  "Thorough Clean", "Deep Clean", "Scrub", "Wash", "Disinfect",
  "Polish", "Sweep", "Mop", "Dry Mop", "Floor Wash", "Floor Wash + Wipe",
  "Refill", "Refill + Clean", "Check", "Fold", "Iron", "Segregation",
  "Water", "Wipe"
];

// Sentence builders — conversational, owner-to-helper voice-message style
const WORK_SENTENCES = {
  "Dusting": (obj) => `do the Dusting of the ${obj} properly`,
  "Dusting + Arrange": (obj) => `do the Dusting and Arrange of the ${obj} — dust well and set everything back neatly`,
  "Light Clean": (obj) => `give the ${obj} a Light Clean — just a quick wipe`,
  "Light Clean + Arrange": (obj) => `give the ${obj} a Light Clean and Arrange — wipe it and set things neatly`,
  "Clean": (obj) => `clean the ${obj} properly`,
  "Clean + Arrange": (obj) => `Clean and Arrange the ${obj} — clean everything and set it in place`,
  "Clean + Wipe": (obj) => `Clean and Wipe the ${obj} down properly`,
  "Clean + Empty": (obj) => `Clean and Empty the ${obj} — put a fresh bag in`,
  "Clean + Water": (obj) => `water the plants and clean around the ${obj}`,
  "Thorough Clean": (obj) => `do a Thorough Clean of the ${obj} — all sides and edges, wipe and sanitise`,
  "Deep Clean": (obj) => `do a Deep Clean of the ${obj} — scrub and leave it spotless`,
  "Scrub": (obj) => `scrub the ${obj} well to remove all stains`,
  "Wash": (obj) => `wash the ${obj} clean with water`,
  "Wash + Wipe": (obj) => `Wash and Wipe the ${obj} — wash it and wipe fully dry, no water marks`,
  "Disinfect": (obj) => `disinfect the ${obj} properly`,
  "Polish": (obj) => `polish the ${obj} until it shines`,
  "Sweep": (obj) => `sweep the ${obj} — pick up all the dust`,
  "Mop": (obj) => `wet mop the ${obj} properly`,
  "Dry Mop": (obj) => `only dry mop the ${obj} — no water there`,
  "Refill": (obj) => `refill the ${obj} as needed`,
  "Refill + Clean": (obj) => `give the ${obj} a light clean and refill`,
  "Check": (obj) => `check the ${obj} and note what's running low`,
  "Fold": (obj) => `fold the ${obj} neatly`,
  "Fold/Arrange": (obj) => `Fold and Arrange the ${obj} nicely`,
  "Iron": (obj) => `iron the ${obj} properly`,
  "Wipe": (obj) => `give the ${obj} a proper wipe`,
  "Wipe + Inspect": (obj) => `wipe the ${obj} clean and check everything is fine`,
  "Shake": (obj) => `shake out the ${obj} well to get the dust off`,
  "Cobweb/Light Clean": (obj) => `check the ${obj} for cobwebs, remove them, and give it a light clean`,
  "Arrange": (obj) => `arrange the ${obj} neatly`,
  "Add-On Work": (obj) => `complete the ${obj} for today`,
  "Segregation": (obj) => `${obj} — segregate dry and wet waste separately and dispose properly`,
  "Monitoring toiletry stock levels.": (obj) => `check the ${obj} and note what needs refilling`,
};

function plusToAnd(str) {
  return str.replace(/\s*\+\s*/g, " and ");
}

function clause(work, object) {
  const obj = plusToAnd(object);
  const builder = WORK_SENTENCES[work];
  if (builder) return builder(obj);
  for (const [key, fn] of Object.entries(WORK_SENTENCES)) {
    if (work.toUpperCase().includes(key.toUpperCase())) return fn(obj);
  }
  return `do the ${plusToAnd(work)} of the ${obj}`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinList(items) {
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
}

function classifySpace(spaceName) {
  const upper = spaceName.toUpperCase();
  if (KITCHEN_SPACES.some(k => upper.includes(k.toUpperCase()))) return "kitchen";
  if (BATHROOM_SPACES.some(b => upper.includes(b.toUpperCase()))) return "bathroom";
  if (upper.includes("BALCONY") || upper.includes("TERRACE") || upper.includes("PORCH") ||
      upper.includes("OUTSIDE") || upper === "FRONT ENTRANCE & GARDEN") return "outer";
  if (upper.includes("WHOLE HOUSE") || upper === "WHOLE HOUSE") return "whole_house";
  return "inner";
}

function isFloorWork(work) {
  return FLOOR_WORKS.some(fw => work.toUpperCase().includes(fw.toUpperCase()));
}

function isFloorObject(object) {
  return object.toUpperCase() === "FLOOR" || object.toUpperCase().startsWith("FLOOR ");
}

function getWorkOrder(work) {
  const idx = WORK_TYPE_ORDER.findIndex(w => work.toUpperCase().includes(w.toUpperCase()));
  return idx >= 0 ? idx : 999;
}

function classifyWholeHouseCategory(object, work) {
  const upper = (object + " " + work).toUpperCase();
  if (upper.includes("CLOTH") || upper.includes("LAUNDRY")) return "clothes";
  if (upper.includes("WATER BOTTLE") || upper.includes("REFILL")) return "water_bottles";
  if (upper.includes("TOILETRI") || upper.includes("CHECK") || upper.includes("MONITORING")) return "toiletries";
  return "other";
}

export function classifyTasks(tasks) {
  const phases = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const wholeHouseInserts = { clothes: [], water_bottles: [], toiletries: [] };

  for (const task of tasks) {
    const spaceType = classifySpace(task.spaceName);
    const isFloor = isFloorObject(task.object) && isFloorWork(task.work);

    if (spaceType === "whole_house" || task.spaceName.toUpperCase().includes("WHOLE HOUSE")) {
      const cat = classifyWholeHouseCategory(task.object, task.work);
      if (cat === "clothes") wholeHouseInserts.clothes.push(task);
      else if (cat === "water_bottles") wholeHouseInserts.water_bottles.push(task);
      else if (cat === "toiletries") wholeHouseInserts.toiletries.push(task);
      else phases[6].push(task);
      continue;
    }

    switch (spaceType) {
      case "inner": isFloor ? phases[2].push(task) : phases[1].push(task); break;
      case "outer": phases[3].push(task); break;
      case "kitchen": phases[4].push(task); break;
      case "bathroom": phases[5].push(task); break;
      default: phases[6].push(task);
    }
  }

  return { phases, wholeHouseInserts };
}

function sortBySpaceAndWork(tasks) {
  return tasks.sort((a, b) => {
    if (a.spaceNo !== b.spaceNo) return a.spaceNo - b.spaceNo;
    return getWorkOrder(a.work) - getWorkOrder(b.work);
  });
}

function groupBySpace(tasks) {
  const groups = {};
  for (const t of tasks) {
    if (!groups[t.spaceName]) groups[t.spaceName] = [];
    groups[t.spaceName].push(t);
  }
  return groups;
}

// Build one flowing paragraph for a space: merge same-work objects,
// then join 2-3 clauses per sentence.
function spaceParagraph(space, spaceTasks, opener) {
  const workGroups = {};
  const workOrder = [];
  for (const t of spaceTasks) {
    if (!workGroups[t.work]) { workGroups[t.work] = []; workOrder.push(t.work); }
    workGroups[t.work].push(t);
  }

  const clauses = [];
  for (const work of workOrder) {
    const items = workGroups[work];
    if (items.length >= 2) {
      const objs = joinList(items.map(t => plusToAnd(t.object)));
      clauses.push(clause(work, objs));
    } else {
      clauses.push(clause(work, items[0].object));
    }
  }

  // Join clauses into sentences of 2 clauses each for natural rhythm.
  // The first sentence continues after the opener's comma, so it stays lowercase.
  const sentences = [];
  for (let i = 0; i < clauses.length; i += 2) {
    const pair = clauses.slice(i, i + 2).join(", and ");
    sentences.push((i === 0 ? pair : capitalize(pair)) + ".");
  }

  return `${opener} ${sentences.join(" ")}`;
}

const SPACE_OPENERS = [
  (s) => `In ${s},`,
  (s) => `Then in ${s},`,
  (s) => `Coming to ${s},`,
  (s) => `Next, in ${s},`,
];

export function generateEnglishScript(tasks, dayInfo) {
  const { phases, wholeHouseInserts } = classifyTasks(tasks);
  const lines = [];
  const phaseCounts = {};
  let openerIdx = 0;
  const nextOpener = (s) => SPACE_OPENERS[(openerIdx++) % SPACE_OPENERS.length](s);

  const totalCount = tasks.length;

  // --- OPENING ---
  lines.push(`--- OPENING ---`);
  lines.push(`Hello. Let me explain today's cleaning in a little detail, so please listen carefully.`);
  lines.push(``);

  // --- DRY WORK (Phase 1, silent) ---
  const p1 = sortBySpaceAndWork(phases[1]);
  phaseCounts[1] = p1.length + wholeHouseInserts.clothes.length;
  if (phaseCounts[1] > 0) {
    lines.push(`--- DRY WORK ---`);
    lines.push(`First, we start with the dry work and dusting.`);

    const spaceGroups = groupBySpace(p1);
    const spaceOrder = [...new Set(p1.map(t => t.spaceName))];
    for (const space of spaceOrder) {
      lines.push(spaceParagraph(space, spaceGroups[space], nextOpener(space)));
    }

    for (const t of wholeHouseInserts.clothes) {
      lines.push(`Also, ${clause(t.work, t.object)}.`);
    }
    lines.push(``);
  }

  // --- FLOOR WORK (Phase 2, silent) ---
  const p2 = sortBySpaceAndWork(phases[2]);
  phaseCounts[2] = p2.length;
  if (p2.length > 0) {
    lines.push(`--- FLOOR WORK ---`);
    lines.push(`After the dusting, it's floor work.`);

    const wetMopRooms = [...new Set(p2.filter(t => t.work.toUpperCase().includes("MOP") && !t.work.toUpperCase().includes("DRY")).map(t => t.spaceName))];
    const dryMopRooms = [...new Set(p2.filter(t => t.work.toUpperCase().includes("DRY MOP")).map(t => t.spaceName))];
    const wetOnly = wetMopRooms.filter(r => !dryMopRooms.includes(r));

    if (wetOnly.length > 0) {
      lines.push(`Sweep properly and then wet mop in ${joinList(wetOnly)}.`);
    }
    if (dryMopRooms.length > 0) {
      lines.push(`In ${joinList(dryMopRooms)}, sweep first and then only dry mop — no wet mopping there.`);
    }
    lines.push(``);
  }

  // --- OUTER (Phase 3, silent) ---
  const p3 = sortBySpaceAndWork(phases[3]);
  phaseCounts[3] = p3.length;
  if (p3.length > 0) {
    lines.push(`--- OUTER AREAS ---`);
    lines.push(`Then the outside areas.`);

    const spaceGroups = groupBySpace(p3);
    const spaceOrder = [...new Set(p3.map(t => t.spaceName))];
    for (const space of spaceOrder) {
      lines.push(spaceParagraph(space, spaceGroups[space], nextOpener(space)));
    }
    lines.push(``);
  }

  // --- KITCHEN (Phase 4, silent) ---
  const p4 = sortBySpaceAndWork(phases[4]);
  phaseCounts[4] = p4.length + wholeHouseInserts.water_bottles.length;
  if (phaseCounts[4] > 0) {
    lines.push(`--- KITCHEN ---`);
    lines.push(`Now let's look at the Kitchen.`);

    const spaceGroups = groupBySpace(p4);
    const spaceOrder = [...new Set(p4.map(t => t.spaceName))];
    for (const space of spaceOrder) {
      const opener = spaceOrder.length > 1 ? nextOpener(space) : `Here,`;
      lines.push(spaceParagraph(space, spaceGroups[space], opener));
    }

    for (const t of wholeHouseInserts.water_bottles) {
      lines.push(`And yes, one more thing — ${clause(t.work, t.object)} for the whole house.`);
    }
    lines.push(``);
  }

  // --- WASHROOMS (Phase 5, silent) ---
  const p5 = sortBySpaceAndWork(phases[5]);
  phaseCounts[5] = p5.length + wholeHouseInserts.toiletries.length;
  if (phaseCounts[5] > 0) {
    lines.push(`--- WASHROOMS ---`);
    lines.push(`In the washrooms —`);

    const spaceGroups = groupBySpace(p5);
    const spaceOrder = [...new Set(p5.map(t => t.spaceName))];
    for (const space of spaceOrder) {
      lines.push(spaceParagraph(space, spaceGroups[space], nextOpener(space)));
    }

    for (const t of wholeHouseInserts.toiletries) {
      lines.push(`Also ${clause(t.work, t.object)}.`);
    }
    lines.push(``);
  }

  // --- CLOSING WORK (Phase 6, silent) ---
  const p6 = phases[6];
  phaseCounts[6] = p6.length;
  if (p6.length > 0) {
    lines.push(`--- CLOSING WORK ---`);
    const closingClauses = p6.map(t => clause(t.work, t.object));
    lines.push(`And lastly, ${closingClauses.join(", and ")}.`);
    lines.push(``);
  }

  // --- CLOSING ---
  lines.push(`--- CLOSING ---`);
  lines.push(`That's all for today. Please do everything carefully and properly. Thank you.`);

  return {
    script: lines.join("\n"),
    lines,
    totalTasks: totalCount,
    phaseCounts,
    phases: {
      1: phaseCounts[1] || 0,
      2: phaseCounts[2] || 0,
      3: phaseCounts[3] || 0,
      4: phaseCounts[4] || 0,
      5: phaseCounts[5] || 0,
      6: phaseCounts[6] || 0,
    }
  };
}
