# Voice Command Script Generation — Skill File

## Purpose
Convert structured cleaning task data (Space, Object, Work) into a natural spoken briefing — like a house owner sending a WhatsApp voice message to their helper. Warm, polite, structured, and conversational. The output feeds Hindi translation and TTS audio generation.

## Scalable Client Model
The generator accepts per-client config via `options` parameter:
- `staffName` — homekeeper's name (default: env `HOMEKEEPER_NAME`)
- `ownerTitle` — how staff refers to owner: Didi/Bhaiya (default: env `OWNER_TITLE`)
- `motherTongue` — affects day names only: "nepali", "hindi" (default: env `HOMEKEEPER_TONGUE`)

Client 1 (Zahab): staffName="Parvati", ownerTitle="Didi", motherTongue="nepali"

## Communication Format — 5 Sections

### Section 1: Greeting
`Namaste {staffName} ji.`

### Section 2: Broad Plan (Overview)
- Day name in mother tongue (e.g. Nepali: Sombaar, Mangalbaar)
- Which spaces have Deep Cleaning today (freq > 4 tasks)
- Space-wise summary of regular cleaning tasks (freq 1–4)

### Section 3: Prep Guideline
Standard equipment readiness reminder.

### Section 4: Detailed Plan of Cleaning
The main body. Follows this exact order:

1. **Whole-house laundry FIRST** — do laundry, bring water bottles to kitchen on the way back
2. **Space-by-space, floor-by-floor:**
   - For each space (by space number within each floor zone):
     a. **Deep Cleaning tasks first** (freq > 4) — objects ordered eye-level → sill-level → foot-level
     b. **Regular Cleaning tasks** (freq 1–4) — ordered by work type
     c. **Sweep/mop for that space** — wet mop or dry mop with warning
   - Complete ALL work in one space before moving to the next
   - Complete ALL spaces on one floor before moving up (staircase = floor boundary)
3. **Kitchen** (Phase 4) — after all floors done; water bottle refill here
4. **Washrooms** (Phase 5) — Harpic protocol:
   a. Put Harpic in WC first (if Light Cleaning) — let it soak
   b. All other bathroom work (upper → lower objects)
   c. Come back to WC, scrub the bowl
   d. Clean the floor last
5. **Closing** (Phase 6) — natural language:
   - Waste Management → "put all the waste in the dustbin properly"
   - Client's Extra Work → "if {ownerTitle} has asked for any extra work today, please do that too"

### Section 5: Ending
`That was all the work for today. You have done everything very nicely. Thank you.`

Hindi target: "Aaj ke liye itna hi kaam karna tha, aapne saare kaam bahut hi ache se kiye hain, Dhanyawaad"

---

## Key Structural Rules

### Space-by-space ordering (NOT phase-by-phase)
OLD: All dry work (all rooms) → All floor work (all rooms)
NEW: Space 1 (deep + regular + sweep/mop) → Space 2 (deep + regular + sweep/mop) → ...

### Floor-Zone Rule (Staircase Boundaries)
- Spaces before the first staircase = Ground Floor zone
- Staircase is the LAST space of its zone (clean it before going up)
- Transition: "Good. Now let's move to the First Floor."
- Complete all spaces on one floor before climbing to the next
- After all floors: Kitchen → Washrooms → Closing

### Object Height Ordering (within Deep Cleaning)
- **Eye-level** (score 0): Ceiling, Ceiling Fan, Light Fixture, Chandelier, Curtains, Wall Decoration, Cobweb, AC, Exhaust Fan, Chimney
- **Sill-level** (score 1): Doors, Windows, Switchboards, Mirrors, Tables, Sofas, Counters, Appliances, Wash Basin, WC — everything at mid-height (DEFAULT)
- **Foot-level** (score 2): Floor, Floor Mat, Area Rug, Skirting/Baseboard, Dustbin, Cord, Spiral Staircase, Under-Stair Storage

### Deep vs Regular Classification
- **Regular**: task frequency 1–4 (daily to every 4 days)
- **Deep**: task frequency > 4 (weekly, fortnightly, monthly, quarterly)
- Deep cleaning tasks go FIRST within each space

---

## Core Style Rules

### NO phase announcements
NEVER say "Phase 1", "Phase 2 done — 16 tasks", or "--- PHASE 3 ---" in spoken text.
Section markers (`--- GREETING ---`, `--- OVERVIEW ---`, etc.) are internal only — filtered out before audio.

### Speak like a voice message, not a checklist
Group 2–4 related tasks into one flowing sentence. Connect with "and", "too", "also", "then".

### Replace `+` with "and"
- "Sofa + Cushions" → "Sofa and Cushions"
- "Clean + Wipe" → "Clean and Wipe"

### Polite-firm register (owner to trusted helper)
Requests, not orders: "please do", "make sure", "give it", "don't forget"

### Natural paragraph transitions
- "Namaste {name} ji."
- "Starting from the Ground Floor."
- "In {Space}," / "Then in {Space}," / "Coming to {Space}," / "Next, in {Space},"
- "Good. Now let's move to the First Floor."
- "Now let's look at the Kitchen."
- "In the washrooms —"
- "And lastly," (for closing)

### Group same-work objects in one sentence
```
do the Dusting of the Door, Ceiling Fan, Switchboard, Sitting Decoration, and Wall Decoration properly
```

---

## Space/Object/Work Name Rules (CRITICAL for Hindi translation)
- Space names: NEVER translate. "Drawing Area" stays "Drawing Area"
- Object names: NEVER translate. "Sofa and Cushions" stays "Sofa and Cushions"
- Work names: NEVER translate. "Dusting and Arrange" stays "Dusting and Arrange"
- Only connective words get translated to Hindi downstream
- Exception: Phase 6 whole-house tasks CAN be said naturally

## Hindi Translation Style (downstream steps)
- RESPECTFUL register, rotating endings: "kar dijiye", "kar lijiye", "kijiyega", "rakhiyega", "karni hai", "karna hoga"
- Never use informal imperative: no "karo", "kar do", "kar lo", "de do", "daalo"
- No symbols in speech: "/" → "ya", "and/+" → "aur", drop "-" from names
- WARM: like a caring house owner's voice note
- Day names in homekeeper's mother tongue (Nepali for Parvati: Sombaar, Mangalbaar, etc.)

### Golden Hindi reference (tone target — Section 4 excerpt)
> Namaste Parvati ji.
> Aaj Sombaar hain, aur Didi ne roj ke kaam ke saath Drawing Area, Powder Room, Foyer, aur Dining Wash Basin ki Deep Cleaning ke liye bola hain.
> ...
> Sabse pehle aap Clothes ko wash kar dijiye, phir wapas niche aate waqt bottle le aakar kitchen me rakh dijiye, baad me paani bharenge.
> Phir Foyer mein, pehle Deep Cleaning — Door ka Thorough Clean karna hai... phir regular cleaning...
> ...
> Aaj ke liye itna hi kaam karna tha, aapne saare kaam bahut hi ache se kiye hain, Dhanyawaad.

---

## Script Skeleton

```
--- GREETING ---
Namaste {staffName} ji.

--- OVERVIEW ---
Today is {dayName}, and {ownerTitle} has asked for regular cleaning along with Deep Cleaning of {spaces}.
Today's regular work is: {space-wise summary}.

--- PREP ---
Before starting, please make sure all your cleaning equipment and supplies are ready and within reach.

--- DETAILED PLAN ---
Now let me explain all the work in detail.

--- LAUNDRY ---
First, {whole house laundry}. While coming back down, bring the water bottles to the kitchen.

--- FLOOR: GROUND FLOOR ---
Starting from the Ground Floor.
[Space-by-space: deep first (eye→sill→foot), then regular, then sweep/mop]

--- FLOOR: FIRST FLOOR ---
Good. Now let's move to the First Floor.
[Space-by-space...]

--- KITCHEN ---
Now let's look at the Kitchen.
[Kitchen spaces, water bottle refill, toiletries check]

--- WASHROOMS ---
In the washrooms —
[Harpic protocol per bathroom: put Harpic → other work → bowl → floor]

--- CLOSING WORK ---
And lastly, {natural language waste + extra work}.

--- ENDING ---
That was all the work for today. You have done everything very nicely. Thank you.
```

Note: `--- SECTION ---` markers are internal separators (used for chunking/editing). They are filtered out before audio generation and must never be spoken.
