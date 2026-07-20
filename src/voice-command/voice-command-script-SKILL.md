# Voice Command Script Generation — Skill File

## Purpose
Convert structured cleaning task data (Space, Object, Work) into a natural spoken briefing — like a house owner sending a WhatsApp voice message to their helper. Warm, polite, structured, and conversational. The output feeds Hindi translation and TTS audio generation.

## The Golden Reference (structure AND tone, Hindi version)
This is the flow and the respectful register the final audio should have (note how endings rotate — dijiye, rakhiyega, karni hai, kar lijiye, hoga, kijiyega):

> Namaste. Aaj ki cleaning main thoda detail mein bata rahi hoon, toh zara dhyaan se sun lijiye.
>
> Sabse pehle dry kaam aur dusting se shuru karte hain. Foyer mein console table aur main door ko wipe karke sanitise kar dijiye, handles par khaas dhyaan rakhiyega. Phir living aur dining area mein, L-shaped sofa, ottoman, aur dining table ki achhe se dusting karni hai. Cushions ko fluff karke theek se set kar lijiye. TV unit, router, coffee table, aur switchboards ko halke se wipe kar dijiye. Mandir ki safaai par bhi thoda dhyan dijiyega.
>
> Dusting ke baad floor ka kaam karna hai. Foyer, living, dining, balcony, aur corridor mein achhe se jhaadu aur geela pocha lagana hoga. Guest room aur master bedroom mein jhaadu ke baad sirf dry mop kijiyega, wahan geela pocha nahi lagega.
>
> Ab kitchen ka dekh lete hain. Dry kitchen mein island, gas stove, aur countertop saaf karke saaman theek se arrange kar lijiye... Aur haan, ghar ki saari water bottles halka sa dho kar refill kar lijiyega.
>
> Washrooms mein, common bathroom ka toilet, basin aur mirror halke se wipe karna hai. Master bathroom theek se saaf kijiyega — toilet, basin, wall tiles, corner shelves aur health faucet wipe honge.
>
> Last mein, ghar ka saara kachra, dry aur wet alag alag segregate karke theek se dispose karna hoga.
>
> Aaj ke liye itna hi kaam hai. Saara kaam aaram se aur dhyaan se kijiyega. Dhanyavaad.

## Input Format
Each task has: `{ spaceName, object, work, material, phase }`
Example: `{ spaceName: "Drawing Area", object: "Sofa + Cushions", work: "Dusting + Arrange" }`

---

## Core Style Rules

### 1. NO phase announcements
NEVER say "Phase 1", "Phase 2 done — 16 tasks", or "--- PHASE 3 ---" in the spoken text.
The worker doesn't need phase numbers — they need the work in the right ORDER.
The phase structure still controls the ORDER of the script, silently:

1. Dry work & surface tasks (room by room) — opens with "First, we start with the dry work and dusting."
2. Floor sweeping & mopping — opens with "After the dusting, it's floor work."
3. Outer spaces (balcony, entrance) — flows in naturally
4. Kitchen — opens with "Now let's look at the Kitchen."
5. Washrooms — opens with "In the washrooms..."
6. Whole-house closing (waste) — opens with "And lastly..."

### 2. Speak like a voice message, not a checklist
BAD (checklist):
```
Sofa + Cushions — Dusting + Arrange.
Window — Dusting.
Dustbin — Clean + Empty.
```
GOOD (voice message):
```
In Living Area, do the Dusting and Arrange of the Coffee Table and the L-Sectional Sofa and Cushions — dust them well and set everything back neatly. Dust the Window too. Fold and Arrange the Throw Blankets nicely, and Clean and Empty the Dustbin — put a fresh bag in.
```
Group 2–4 related tasks into one flowing sentence. Connect with "and", "too", "also", "then".

### 3. Replace `+` with "and"
- "Sofa + Cushions" → "Sofa and Cushions"
- "Clean + Wipe" → "Clean and Wipe"

### 4. Polite-firm register (owner to trusted helper)
- Requests, not orders: "please do", "make sure", "give it", "don't forget"
- Small personal touches: "pay special attention to the handles", "And yes, one more thing —"
- Care notes where it matters: "only dry mop there — no wet mopping", "streak-free, no water marks"

### 5. Natural paragraph transitions (fillers)
- "First, we start with..."
- "Then in [Space]..."
- "After the dusting, it's floor work."
- "Now let's look at the Kitchen."
- "In the washrooms..."
- "And yes, one more thing —" (for whole-house inserts like water bottles)
- "And lastly..." (for waste/closing)

### 6. Group floor work by mop type
List all wet-mop rooms in ONE sentence, then dry-mop rooms with the warning:
```
Sweep and then wet mop properly in Foyer Area, Drawing Area, Dining Area, 1st Floor Staircase, Upper Foyer, and Living Area.
In Guest Room & Office 2 and Master Bedroom, sweep first and then only dry mop — no wet mopping there.
```

### 7. Group same-work objects in one sentence
```
Now wipe down all the appliances — Coffee Machine, Microwave, Oven, Toaster and Kettles, RO Purifier, and the Mobile Storage Trolley. Give each one a proper wipe.
```

---

## Script Skeleton

```
--- OPENING ---
Hello. Let me explain today's cleaning in a little detail, so please listen carefully.

--- DRY WORK ---
First, we start with the dry work and dusting.
[Space by space: transition + grouped flowing sentences]
[Whole House clothes work if any: "Also, put the laundry for wash."]

--- FLOOR WORK ---
After the dusting, it's floor work.
[Wet-mop rooms in one sentence; dry-mop rooms in one sentence with warning]

--- OUTER ---
[If any: "Then the outside areas." + grouped sentences]

--- KITCHEN ---
Now let's look at the Kitchen.
[Grouped by work type: dusting items together, wipe items together, etc.]
[Water bottles: "And yes, give all the house Water Bottles a light rinse and refill them."]

--- WASHROOMS ---
In the washrooms —
[Bathroom by bathroom, grouped sentences]
[Toiletries: "Also check the Toiletries and note what's running low."]

--- CLOSING WORK ---
And lastly, [waste segregation / extra work sentences].

--- CLOSING ---
That's all for today. Please do everything carefully and properly. Thank you.
```

Note: the `--- SECTION ---` markers are internal separators only (used for chunking/editing). They are filtered out before audio generation and must never be turned into spoken words.

---

## Space/Object/Work Name Rules (CRITICAL for Hindi translation)
- Space names: NEVER translate. "Drawing Area" stays "Drawing Area"
- Object names: NEVER translate. "Sofa and Cushions" stays "Sofa and Cushions"
- Work names: NEVER translate. "Dusting and Arrange" stays "Dusting and Arrange"
- Only connective words get translated to Hindi downstream

## Hindi Translation Style (downstream steps)
- RESPECTFUL register, rotating endings: "kar dijiye", "kar lijiye", "kijiyega", "rakhiyega", "karni hai", "karna hoga", "wipe honge" — never the same ending on every line
- Never use an informal imperative, even if it is present in the task description: no "karo", "kar do", "kar lo", "de do", "daalo", "bharo", "utha lo", "hatao", "rakho", "dekho", "suno", or "aao". Convert these to warm respectful forms such as "kijiye", "kar dijiye", "kar lijiye", "de dijiye", "daal dijiye", "bhar dijiye", "utha lijiye", "hata dijiye", "rakh dijiye", "dekhiye", "suniye", and "aaiye". Avoid over-familiar "kar dena / kar lena" as the default.
- No symbols in speech: "/" → "ya", "and/+" → "aur", drop "-" from names ("Window - 1" → "Window 1")
- WARM: like a caring house owner's voice note
- CLEAR: simple words, easy to follow
- NATURAL: Khadiboli flow, not textbook Hindi

### Golden Hindi reference (tone target)
> Namaste. Aaj ki cleaning main thoda detail mein bata rahi hoon, toh zara dhyaan se sun lijiye.
> Sabse pehle dry kaam aur dusting se shuru karte hain. Foyer mein Console Table aur Main Door ko wipe karke sanitise kar dijiye, handles par khaas dhyaan rakhiyega... Cushions ko fluff karke theek se set kar lijiye... Mandir ki safaai par bhi thoda dhyan dijiyega.
> Dusting ke baad floor ka kaam karna hai... Guest Room aur Master Bedroom mein jhaadu ke baad sirf dry mop kijiyega, wahan geela pocha nahi lagega.
> Aur haan, ghar ki saari Water Bottles halka sa dho kar refill kar lijiyega.
> Aaj ke liye itna hi kaam hai. Saara kaam aaram se aur dhyaan se kijiyega. Dhanyavaad.
