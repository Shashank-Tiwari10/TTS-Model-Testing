// ── Default client config (overridden via options parameter per client) ──
const DEFAULT_CLIENT = {
  staffName:    process.env.HOMEKEEPER_NAME   || "Parvati",
  ownerTitle:   process.env.OWNER_TITLE       || "Didi",
  motherTongue: process.env.HOMEKEEPER_TONGUE || "nepali",
};

const REGULAR_FREQ_MAX = 4; // freq 1–4 = regular; > 4 = deep cleaning

const DAY_NAMES = {
  nepali: { Mon: "Sombaar",  Tue: "Mangalbaar", Wed: "Budhabaar",
            Thu: "Bihibaar", Fri: "Sukrabaar",  Sat: "Sanibaar" },
  hindi:  { Mon: "Somvaar",  Tue: "Mangalvaar", Wed: "Budhvaar",
            Thu: "Guruvaar", Fri: "Shukravaar", Sat: "Shanivaar" },
};

// ── Space lists ──────────────────────────────────────────────────
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

// ── Sentence builders — conversational voice-message style ───────
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
  "Make Bed": (obj) => `do the Make Bed of the ${obj}`,
  "Vacuum": (obj) => `do the Vacuum of the ${obj}`,
};

// ── Utility functions ────────────────────────────────────────────

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

// ── Space classification ─────────────────────────────────────────

function classifySpace(spaceName) {
  const upper = spaceName.toUpperCase();
  if (KITCHEN_SPACES.some(k => upper.includes(k.toUpperCase()))) return "kitchen";
  if (BATHROOM_SPACES.some(b => upper.includes(b.toUpperCase()))) return "bathroom";
  if (upper.includes("BALCONY") || upper.includes("TERRACE") || upper.includes("PORCH") ||
      upper.includes("OUTSIDE") || upper === "FRONT ENTRANCE & GARDEN") return "outer";
  if (upper.includes("WHOLE HOUSE") || upper === "WHOLE HOUSE") return "whole_house";
  return "inner";
}

function isStaircase(spaceName) {
  return /staircase|(?:^|\s)stair(?:s)?(?:\s|$)/i.test(spaceName);
}

function isFloorWork(work) {
  return FLOOR_WORKS.some(fw => work.toUpperCase().includes(fw.toUpperCase()));
}

function isFloorObject(object) {
  return object.toUpperCase() === "FLOOR" || object.toUpperCase().startsWith("FLOOR ");
}

function isFloorTask(task) {
  return isFloorObject(task.object) && isFloorWork(task.work);
}

function getWorkOrder(work) {
  const idx = WORK_TYPE_ORDER.findIndex(w => work.toUpperCase().includes(w.toUpperCase()));
  return idx >= 0 ? idx : 999;
}

// ── Object height classification (eye → sill → foot) ────────────

function getObjectHeight(objectName) {
  const upper = objectName.toUpperCase();
  if (/CEILING|CHANDELIER|CURTAIN|DRAPE|WALL DECORATION|WALL ART|COBWEB|EXHAUST|OVERH[AE]+D|CHIMNEY/.test(upper)) return 0;
  if (/^AC$|^AC\s/.test(upper) || upper.includes(" AC")) return 0;
  if (upper.includes("CEILING FAN") || upper.includes("LIGHT FIXTURE")) return 0;
  if (/^FLOOR$|^FLOOR\s|SKIRTING|BASEBOARD|DUSTBIN|UNDER.?STAIR|SPIRAL STAIRCASE|^CORD$/.test(upper)) return 2;
  if (upper.endsWith(" MAT") || upper.includes("AREA RUG")) return 2;
  return 1;
}

function isWCObject(objectName) {
  const upper = objectName.toUpperCase();
  return upper === "WC" || upper === "TOILET" || /^WC[/ ]/.test(upper);
}

// ── Whole-house category classification ──────────────────────────

function classifyWholeHouseCategory(object, work) {
  const upper = (object + " " + work).toUpperCase();
  if (upper.includes("CLOTH") || upper.includes("LAUNDRY")) return "clothes";
  if (upper.includes("WATER BOTTLE") || upper.includes("REFILL")) return "water_bottles";
  if (upper.includes("TOILETRI") || upper.includes("CHECK") || upper.includes("MONITORING")) return "toiletries";
  return "other";
}

// ── Floor zone splitting (staircase boundaries) ──────────────────

function parseFloorLabel(staircaseName) {
  const match = staircaseName.match(/[-–—]\s*(\w+)\s*$/);
  if (!match) return "the next floor";
  const dest = match[1].toUpperCase();
  const labels = {
    "GF": "the Ground Floor", "1F": "the First Floor",
    "2F": "the Second Floor", "3F": "the Third Floor",
    "4F": "the Fourth Floor", "BF": "the Basement", "RF": "the Roof",
  };
  return labels[dest] || dest;
}

function splitIntoFloorZones(tasks) {
  const sorted = [...tasks].sort((a, b) => a.spaceNo - b.spaceNo);
  const spaceOrder = [];
  const seen = new Set();
  for (const t of sorted) {
    if (!seen.has(t.spaceName)) { seen.add(t.spaceName); spaceOrder.push(t.spaceName); }
  }

  const zones = [];
  let currentSpaces = [];
  for (const spaceName of spaceOrder) {
    currentSpaces.push(spaceName);
    if (isStaircase(spaceName)) {
      zones.push({ spaces: [...currentSpaces], staircase: spaceName });
      currentSpaces = [];
    }
  }
  if (currentSpaces.length > 0) zones.push({ spaces: currentSpaces, staircase: null });

  return zones.map((z, idx) => {
    const nameSet = new Set(z.spaces);
    return {
      index: idx,
      label: idx === 0 ? "Ground Floor"
           : z.staircase ? parseFloorLabel(zones[idx - 1]?.staircase || "").replace("the ", "")
           : `Floor ${idx + 1}`,
      spaces: z.spaces,
      staircase: z.staircase,
      tasks: sorted.filter(t => nameSet.has(t.spaceName)),
    };
  });
}

// ── Build grouped clauses (merge same-work objects) ──────────────

function buildGroupedClauses(tasks) {
  const workGroups = {};
  const workOrder = [];
  for (const t of tasks) {
    if (!workGroups[t.work]) { workGroups[t.work] = []; workOrder.push(t.work); }
    workGroups[t.work].push(t);
  }
  const clauses = [];
  for (const work of workOrder) {
    const items = workGroups[work];
    if (items.length >= 2) {
      clauses.push(clause(work, joinList(items.map(t => plusToAnd(t.object)))));
    } else {
      clauses.push(clause(work, items[0].object));
    }
  }
  return clauses;
}

function clausesToSentences(clauses) {
  const sentences = [];
  for (let i = 0; i < clauses.length; i += 2) {
    const pair = clauses.slice(i, i + 2).join(", and ");
    sentences.push((i === 0 ? pair : capitalize(pair)) + ".");
  }
  return sentences.join(" ");
}

// ── Space openers (rotating) ─────────────────────────────────────

const SPACE_OPENERS = [
  (s) => `In ${s},`,
  (s) => `Then in ${s},`,
  (s) => `Coming to ${s},`,
  (s) => `Next, in ${s},`,
];

// ── Space block: deep first (eye→sill→foot), regular, then floor ─

function generateSpaceBlock(spaceTasks, opener) {
  const deep    = spaceTasks.filter(t => t.freq > REGULAR_FREQ_MAX && !isFloorTask(t));
  const regular = spaceTasks.filter(t => t.freq <= REGULAR_FREQ_MAX && !isFloorTask(t));
  const floor   = spaceTasks.filter(t => isFloorTask(t));

  deep.sort((a, b) => getObjectHeight(a.object) - getObjectHeight(b.object) || getWorkOrder(a.work) - getWorkOrder(b.work));
  regular.sort((a, b) => getWorkOrder(a.work) - getWorkOrder(b.work));

  const lines = [];

  if (deep.length > 0) {
    const deepClauses = buildGroupedClauses(deep);
    const deepText = clausesToSentences(deepClauses);
    if (regular.length > 0 || floor.length > 0) {
      lines.push(`${opener} first the Deep Cleaning — ${deepText}`);
    } else {
      lines.push(`${opener} ${deepText}`);
    }
  }

  if (regular.length > 0) {
    const regClauses = buildGroupedClauses(regular);
    const regText = clausesToSentences(regClauses);
    if (deep.length > 0) {
      lines.push(`Then for the regular cleaning, ${regText}`);
    } else {
      lines.push(`${opener} ${regText}`);
    }
  }

  if (floor.length > 0) {
    const hasWetMop = floor.some(t => t.work.toUpperCase().includes("MOP") && !t.work.toUpperCase().includes("DRY"));
    const hasDryMop = floor.some(t => t.work.toUpperCase().includes("DRY MOP"));

    if (hasWetMop)      lines.push("Then sweep and wet mop the floor properly.");
    else if (hasDryMop) lines.push("Then sweep and only dry mop the floor — no wet mopping here.");
    else                lines.push("Then sweep the floor properly.");
  }

  return lines;
}

// ── Washroom block: Harpic first → other work → bowl → floor ────

function generateWashroomBlock(spaceTasks, opener) {
  const wcLight = spaceTasks.filter(t => isWCObject(t.object) && /LIGHT CLEAN/i.test(t.work));
  const wcOther = spaceTasks.filter(t => isWCObject(t.object) && !/LIGHT CLEAN/i.test(t.work));
  const floorT  = spaceTasks.filter(t => isFloorObject(t.object));
  const otherT  = spaceTasks.filter(t => !isWCObject(t.object) && !isFloorObject(t.object));

  otherT.sort((a, b) => getObjectHeight(a.object) - getObjectHeight(b.object) || getWorkOrder(a.work) - getWorkOrder(b.work));

  const lines = [];

  if (wcLight.length > 0) {
    lines.push(`${opener} first put Harpic in the WC and let it soak.`);
  }

  if (otherT.length > 0) {
    const otherClauses = buildGroupedClauses(otherT);
    const otherText = clausesToSentences(otherClauses);
    lines.push(`${wcLight.length > 0 ? "Meanwhile," : opener} ${otherText}`);
  }

  if (wcLight.length > 0) {
    lines.push("Now come back to the WC, scrub the bowl clean with the brush.");
  }
  if (wcOther.length > 0) {
    const wcClauses = wcOther.map(t => clause(t.work, t.object));
    lines.push(`Also ${wcClauses.join(", and ")}.`);
  }

  if (floorT.length > 0) {
    lines.push(`Lastly, ${clause(floorT[0].work, floorT[0].object)}.`);
  }

  return lines;
}

// ── Natural-language closing (Phase 6) ───────────────────────────

function naturalClosingClause(task, ownerTitle) {
  const combined = (task.object + " " + task.work).toUpperCase();
  if (combined.includes("WASTE") || combined.includes("SEGREGAT")) {
    return "put all the waste in the dustbin properly, separate dry and wet";
  }
  if (combined.includes("ADD-ON") || combined.includes("EXTRA") || combined.includes("CLIENT")) {
    return `if ${ownerTitle} has asked for any extra work today, please do that too`;
  }
  return clause(task.work, task.object);
}

// ── Broad plan (space-wise summary of regular tasks) ─────────────

function buildBroadPlan(tasks) {
  const spaceMap = {};
  const spaceOrder = [];

  for (const t of tasks) {
    if (classifySpace(t.spaceName) === "whole_house") continue;
    if (t.freq > REGULAR_FREQ_MAX) continue;
    if (!spaceMap[t.spaceName]) {
      spaceMap[t.spaceName] = { objects: new Set(), spaceNo: t.spaceNo };
      spaceOrder.push(t.spaceName);
    }
    spaceMap[t.spaceName].objects.add(plusToAnd(t.object));
  }

  spaceOrder.sort((a, b) => (spaceMap[a].spaceNo || 0) - (spaceMap[b].spaceNo || 0));

  return spaceOrder.map(space => {
    const objs = [...spaceMap[space].objects];
    if (objs.length <= 3) return `${space} — ${objs.join(", ")}`;
    return `${space} — ${objs.slice(0, 3).join(", ")} and more`;
  }).join("; ");
}

// ══════════════════════════════════════════════════════════════════
// Task classification
// ══════════════════════════════════════════════════════════════════

export function classifyTasks(tasks) {
  const kitchen    = [];
  const bathroom   = [];
  const closing    = [];
  const wholeHouse = { clothes: [], water_bottles: [], toiletries: [] };
  const zoneable   = [];

  for (const task of tasks) {
    const spaceType = classifySpace(task.spaceName);

    if (spaceType === "whole_house" || task.spaceName.toUpperCase().includes("WHOLE HOUSE")) {
      const cat = classifyWholeHouseCategory(task.object, task.work);
      if (cat === "clothes")            wholeHouse.clothes.push(task);
      else if (cat === "water_bottles") wholeHouse.water_bottles.push(task);
      else if (cat === "toiletries")    wholeHouse.toiletries.push(task);
      else                              closing.push(task);
      continue;
    }

    if (spaceType === "kitchen")  { kitchen.push(task);  continue; }
    if (spaceType === "bathroom") { bathroom.push(task); continue; }
    zoneable.push(task);
  }

  const floorZones = splitIntoFloorZones(zoneable);

  const deepSpaces = [...new Set(
    tasks
      .filter(t => t.freq > REGULAR_FREQ_MAX && classifySpace(t.spaceName) !== "whole_house")
      .map(t => t.spaceName)
  )];

  // Phase counts for backward-compat return value
  const phaseCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const t of zoneable) {
    if (isFloorTask(t))                          phaseCounts[2]++;
    else if (classifySpace(t.spaceName) === "outer") phaseCounts[3]++;
    else                                         phaseCounts[1]++;
  }
  phaseCounts[1] += wholeHouse.clothes.length;
  phaseCounts[4]  = kitchen.length + wholeHouse.water_bottles.length;
  phaseCounts[5]  = bathroom.length + wholeHouse.toiletries.length;
  phaseCounts[6]  = closing.length;

  return { floorZones, kitchen, bathroom, closing, wholeHouse, deepSpaces, phaseCounts };
}

// ══════════════════════════════════════════════════════════════════
// Main script generator — 5-section Work Structure format
// ══════════════════════════════════════════════════════════════════

export function generateEnglishScript(tasks, dayInfo, options = {}) {
  const staffName  = options.staffName    || DEFAULT_CLIENT.staffName;
  const ownerTitle = options.ownerTitle   || DEFAULT_CLIENT.ownerTitle;
  const tongue     = options.motherTongue || DEFAULT_CLIENT.motherTongue;
  const dayName    = (DAY_NAMES[tongue] || DAY_NAMES.nepali)[dayInfo.weekday] || dayInfo.weekday;

  const {
    floorZones, kitchen, bathroom, closing,
    wholeHouse, deepSpaces, phaseCounts,
  } = classifyTasks(tasks);

  const lines = [];
  let openerIdx = 0;
  const nextOpener = (s) => SPACE_OPENERS[(openerIdx++) % SPACE_OPENERS.length](s);

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1 — GREETING
  // ═══════════════════════════════════════════════════════════════
  lines.push("--- GREETING ---");
  lines.push(`Namaste ${staffName} ji.`);
  lines.push("");

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2 — BROAD PLAN (day name, deep cleaning spaces, regular overview)
  // ═══════════════════════════════════════════════════════════════
  lines.push("--- OVERVIEW ---");
  if (deepSpaces.length > 0) {
    lines.push(
      `Today is ${dayName}, and ${ownerTitle} has asked for regular cleaning along with Deep Cleaning of ${joinList(deepSpaces)}.`
    );
  } else {
    lines.push(`Today is ${dayName}. Here is today's regular cleaning plan.`);
  }

  const broadPlan = buildBroadPlan(tasks);
  if (broadPlan) {
    lines.push(`Today's regular work is: ${broadPlan}.`);
  }
  lines.push("");

  // ═══════════════════════════════════════════════════════════════
  // SECTION 3 — PREP GUIDELINE
  // ═══════════════════════════════════════════════════════════════
  lines.push("--- PREP ---");
  lines.push("Before starting, please make sure all your cleaning equipment and supplies are ready and within reach.");
  lines.push("");

  // ═══════════════════════════════════════════════════════════════
  // SECTION 4 — DETAILED PLAN OF CLEANING
  // ═══════════════════════════════════════════════════════════════
  lines.push("--- DETAILED PLAN ---");
  lines.push("Now let me explain all the work in detail.");
  lines.push("");

  // ── 4a. Whole-house laundry FIRST ──────────────────────────────
  if (wholeHouse.clothes.length > 0) {
    lines.push("--- LAUNDRY ---");
    const laundryClauses = wholeHouse.clothes.map(t => clause(t.work, t.object));
    lines.push(`First, ${laundryClauses.join(", and ")}.`);
    if (wholeHouse.water_bottles.length > 0) {
      lines.push("While coming back down, bring the water bottles to the kitchen — we will fill them later.");
    }
    lines.push("");
  }

  // ── 4b. Floor-by-floor, space-by-space ─────────────────────────
  const activeZones = floorZones.filter(z => z.tasks.length > 0);
  const hasMultipleZones = activeZones.length > 1;

  for (let zi = 0; zi < activeZones.length; zi++) {
    const zone = activeZones[zi];

    if (hasMultipleZones) {
      lines.push(`--- FLOOR: ${zone.label.toUpperCase()} ---`);
      if (zi === 0) {
        lines.push(`Starting from the ${zone.label}.`);
      } else {
        lines.push(`Good. Now let's move to the ${zone.label}.`);
      }
    }

    // Group tasks by space, preserving space-number order
    const spaceMap = {};
    const spaceOrder = [];
    for (const t of zone.tasks) {
      if (!spaceMap[t.spaceName]) { spaceMap[t.spaceName] = []; spaceOrder.push(t.spaceName); }
      spaceMap[t.spaceName].push(t);
    }

    for (const space of spaceOrder) {
      const block = generateSpaceBlock(spaceMap[space], nextOpener(space));
      for (const line of block) lines.push(line);
    }

    lines.push("");
  }

  // ── 4c. Kitchen (Phase 4) ──────────────────────────────────────
  const sortedKitchen = [...kitchen].sort((a, b) => a.spaceNo - b.spaceNo || getWorkOrder(a.work) - getWorkOrder(b.work));
  if (sortedKitchen.length > 0 || wholeHouse.water_bottles.length > 0 || wholeHouse.toiletries.length > 0) {
    lines.push("--- KITCHEN ---");
    lines.push("Now let's look at the Kitchen.");

    const kitchenSpaceMap = {};
    const kitchenSpaceOrder = [];
    for (const t of sortedKitchen) {
      if (!kitchenSpaceMap[t.spaceName]) { kitchenSpaceMap[t.spaceName] = []; kitchenSpaceOrder.push(t.spaceName); }
      kitchenSpaceMap[t.spaceName].push(t);
    }

    for (const space of kitchenSpaceOrder) {
      const opener = kitchenSpaceOrder.length > 1 ? nextOpener(space) : "Here,";
      const block = generateSpaceBlock(kitchenSpaceMap[space], opener);
      for (const line of block) lines.push(line);
    }

    if (wholeHouse.water_bottles.length > 0 && wholeHouse.clothes.length > 0) {
      lines.push("Now fill the water bottles that you brought to the kitchen earlier.");
    } else if (wholeHouse.water_bottles.length > 0) {
      for (const t of wholeHouse.water_bottles) {
        lines.push(`And yes, one more thing — ${clause(t.work, t.object)} for the whole house.`);
      }
    }

    for (const t of wholeHouse.toiletries) {
      lines.push(`Also ${clause(t.work, t.object)}.`);
    }

    lines.push("");
  }

  // ── 4d. Washrooms (Phase 5) — Harpic protocol ─────────────────
  const sortedBathroom = [...bathroom].sort((a, b) => a.spaceNo - b.spaceNo || getWorkOrder(a.work) - getWorkOrder(b.work));
  if (sortedBathroom.length > 0) {
    lines.push("--- WASHROOMS ---");
    lines.push("In the washrooms —");

    const bathSpaceMap = {};
    const bathSpaceOrder = [];
    for (const t of sortedBathroom) {
      if (!bathSpaceMap[t.spaceName]) { bathSpaceMap[t.spaceName] = []; bathSpaceOrder.push(t.spaceName); }
      bathSpaceMap[t.spaceName].push(t);
    }

    for (const space of bathSpaceOrder) {
      const block = generateWashroomBlock(bathSpaceMap[space], nextOpener(space));
      for (const line of block) lines.push(line);
    }

    if (sortedKitchen.length === 0 && wholeHouse.toiletries.length > 0) {
      for (const t of wholeHouse.toiletries) {
        lines.push(`Also ${clause(t.work, t.object)}.`);
      }
    }

    lines.push("");
  }

  // ── 4e. Closing (Phase 6) — natural language ──────────────────
  if (closing.length > 0) {
    lines.push("--- CLOSING WORK ---");
    const closingParts = closing.map(t => naturalClosingClause(t, ownerTitle));
    lines.push(`And lastly, ${closingParts.join(", and ")}.`);
    lines.push("");
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 5 — ENDING
  // ═══════════════════════════════════════════════════════════════
  lines.push("--- ENDING ---");
  lines.push("That was all the work for today. You have done everything very nicely. Thank you.");

  return {
    script: lines.join("\n"),
    lines,
    totalTasks: tasks.length,
    phaseCounts,
    phases: {
      1: phaseCounts[1] || 0,
      2: phaseCounts[2] || 0,
      3: phaseCounts[3] || 0,
      4: phaseCounts[4] || 0,
      5: phaseCounts[5] || 0,
      6: phaseCounts[6] || 0,
    },
  };
}
