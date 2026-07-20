import OpenAI from "openai";
import axios from "axios";

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const ENGLISH_TO_KHADIBOLI_ROMAN_PROMPT = `You are a Hindi language expert specializing in Khadiboli Hindi (खड़ीबोली).

Convert the following English cleaning instructions into Khadiboli Hindi written in ROMAN SCRIPT (Latin letters). The voice is a warm, caring house owner leaving a voice message for their trusted house helper — polite and respectful, but natural and human, never robotic.

CRITICAL RULES:

1. VARY the respectful endings — do NOT end every sentence with "kijiye" or "dijiye". A real person mixes many respectful forms naturally. Rotate between:
   - "kar dijiye" / "kar lijiye" / "laga dijiye" / "daal dijiye" (respectful requests — the core register)
   - "kijiyega" / "rakhiyega" / "dijiyega" / "lijiyega" (soft future-respectful, very warm)
   - "karni hai" / "karne hain" / "karna hai" / "karna hoga" / "wipe honge" / "mop karna rahega" (task-framing — neutral, no ending needed)
   - "khaas dhyaan rakhiyega" / "thoda dhyan dijiyega" (care notes)
   NEVER copy informal commands from the source, even when the English task description itself contains Hinglish words such as "karo", "kar do", "kar lo", "de do", "daalo", "bharo", "utha lo", "hatao", "rakho", "dekho", "suno", or "aao".
   These are forbidden in the output because this is a warm, respectful voice note. Convert them to respectful forms, for example: karo→kijiye, kar do→kar dijiye, kar lo→kar lijiye, de do→de dijiye, daalo→daal dijiye, bharo→bhar dijiye, utha lo→utha lijiye, hatao→hata dijiye, rakho→rakh dijiye, dekho→dekhiye, suno→suniye, aao→aaiye. Avoid "kar dena"/"kar lena" as the default.
   BAD (robotic — same ending everywhere):
   "Sofa ki Dusting kar dijiye. Table saaf kar dijiye. Floor par pocha laga dijiye."
   GOOD (natural human mix — endings rotate):
   "Sofa aur Cushions ki achhe se Dusting karni hai. Table ko halka sa wipe kar dijiye, aur Floor par geela pocha lagana hoga — kono par khaas dhyaan rakhiyega."

2. NEVER translate or change Space names, Object names, or Work/Task names. Keep them EXACTLY in English:
   - "Drawing Area" stays "Drawing Area" (NOT "Chitrakaari Ka Kamra")
   - "Sofa and Cushions" stays "Sofa and Cushions"
   - "Dusting and Arrange" stays "Dusting and Arrange"
   - "Coffee Table", "Floor", "Sweep", "Mop", "Light Clean" all stay in English

3. NO symbols in spoken text — convert them to spoken words:
   - "/" becomes "ya" → "WC / Toilet" becomes "WC ya Toilet"
   - "+" or "and" between objects becomes "aur" → "Sofa and Cushions" becomes "Sofa aur Cushions"
   - "-" in names is silently dropped → "Geyser - Body" becomes "Geyser Body", "Window - 1" becomes "Window 1"
   - "—" (dash) becomes a natural pause, comma, or connective — never spoken as a symbol

4. Do not overuse any single filler word. Vary connectives: "phir", "uske baad", "ab", "aur haan", "waise", "sabse pehle", "last mein". Each should appear naturally, not repeated line after line.

5. Keep section markers like "--- OPENING ---" or "--- DRY WORK ---" exactly as-is (they are internal separators, not spoken).

6. Numbers stay as digits.

GOLDEN EXAMPLE of the target tone (study how the endings rotate — dijiye, rakhiyega, karni hai, kar lijiye, hoga, kijiyega — never the same twice in a row):
"Namaste. Aaj ki cleaning main thoda detail mein bata rahi hoon, toh zara dhyaan se sun lijiye.
Sabse pehle dry kaam aur dusting se shuru karte hain. Foyer mein Console Table aur Main Door ko wipe karke sanitise kar dijiye, handles par khaas dhyaan rakhiyega. Phir Living aur Dining Area mein, L-shaped Sofa, Ottoman, aur Dining Table ki achhe se dusting karni hai. Cushions ko fluff karke theek se set kar lijiye. TV Unit, Router, Coffee Table, aur Switchboards ko halke se wipe kar dijiye. Mandir ki safaai par bhi thoda dhyan dijiyega.
Dusting ke baad floor ka kaam karna hai. Foyer, Living, Dining, Balcony, aur Corridor mein achhe se jhaadu aur geela pocha lagana hoga. Guest Room aur Master Bedroom mein jhaadu ke baad sirf dry mop kijiyega, wahan geela pocha nahi lagega.
Ab Kitchen ka dekh lete hain. Dry Kitchen mein Island, Gas Stove, aur Countertop saaf karke saaman theek se arrange kar lijiye. Floor Mat ko wash karke wahan jhaadu-pocha laga dijiye. Aur haan, ghar ki saari Water Bottles halka sa dho kar refill kar lijiyega.
Washrooms mein, Common Bathroom ka Toilet, Basin aur Mirror halke se wipe karna hai. Master Bathroom theek se saaf kijiyega — Toilet, Basin, Wall Tiles, Corner Shelves aur Health Faucet wipe honge. Mirror streak-free saaf karke, floor ko dho kar achhe se dry kar dijiye.
Last mein, ghar ka saara kachra, dry aur wet alag alag segregate karke theek se dispose karna hoga.
Aaj ke liye itna hi kaam hai. Saara kaam aaram se aur dhyaan se kijiyega. Dhanyavaad."

STRICT OUTPUT RULE: Translate ONLY the lines given below — line by line, same order, same structure. Do NOT add, remove, merge, or invent any tasks, spaces, objects, or sections. The golden example above shows TONE only; never copy its content, spaces, or objects into your output. Every space/object name in your output MUST exist in the input. Output must have exactly the same lines and section markers as the input.

Convert ALL lines below. Return ONLY the converted text, line by line:`;

const ROMAN_TO_DEVANAGARI_PROMPT = `You are a Hindi transliteration expert.

Convert the following Khadiboli Hindi text from ROMAN SCRIPT to DEVANAGARI SCRIPT (देवनागरी).

CRITICAL RULES:
1. NEVER translate or change Space names, Object names, or Work Type names. They MUST stay in English/Roman exactly as they are. Examples:
   - "Drawing Area" stays as "Drawing Area" (NOT "ड्राइंग एरिया")
   - "Sofa + Cushions" stays as "Sofa + Cushions" (NOT "सोफा + कुशन")
   - "Dusting + Arrange" stays as "Dusting + Arrange" (NOT "डस्टिंग + अरेंज")
   - "Coffee Table" stays as "Coffee Table"
   - "Floor" stays as "Floor"
   - "Sweep" stays as "Sweep"
   - "Mop" stays as "Mop"
   - "Light Clean" stays as "Light Clean"
   - "Clean + Wipe" stays as "Clean + Wipe"
   - "Kitchen" stays as "Kitchen"
   - "Master Bedroom" stays as "Master Bedroom"
   - "Phase 1" stays as "Phase 1"
2. Convert ALL the Hindi words to Devanagari: mein→में, ki→की, ka→का, ko→को, ab→अब, kaam→काम, khatam→खत्म, kar dena→कर देना, kar lena→कर लेना, kijiyega→कीजियेगा, dhyaan rakhna→ध्यान रखना, aur→और, ya→या, etc.
3. Keep all English proper nouns, object names, space names, work type names in Roman/English script
4. Keep section markers like "--- OPENING ---" or "--- DRY WORK ---" exactly as-is
5. Numbers stay as digits
6. NO symbols like "/", "+", "—" in the output — if any slipped through, convert: "/" → या, "and"/"+" between objects → और, drop "-" from names ("Window - 1" → "Window 1")

Example input: "Drawing Area mein Sofa + Cushions ki Dusting + Arrange kar dijiye."
Example output: "Drawing Area में Sofa + Cushions की Dusting + Arrange कर दीजिये।"

Example input: "Ab Kitchen mein aa jaiye."
Example output: "अब Kitchen में आ जाइये।"

Example input: "Sweeping ka kaam khatam hua."
Example output: "Sweeping का काम खत्म हुआ।"

Convert ALL lines below. Return ONLY the converted text, line by line:`;

const OPENAI_MODELS = {
  openai: "gpt-4o-mini",
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4o": "gpt-4o",
  "gpt-5.6-sol": "gpt-5.6-sol",
  "gpt-5.6-terra": "gpt-5.6-terra",
  "gpt-5.6-luna": "gpt-5.6-luna",
};

const SARVAM_MAYURA_MODEL = "sarvam-mayura";
const SARVAM_API_URL = "https://api.sarvam.ai";

export function isOpenAIModel(model) {
  return Boolean(OPENAI_MODELS[model]);
}

export async function translateToKhadiboliRoman(englishScript, model = "openai", styleInstructions) {
  let prompt = ENGLISH_TO_KHADIBOLI_ROMAN_PROMPT;
  if (styleInstructions && styleInstructions.trim()) {
    prompt += `\n\nADDITIONAL STYLE INSTRUCTIONS FROM USER:\n${styleInstructions.trim()}\n\nFollow these style instructions carefully while keeping all the critical rules above.`;
  }
  if (isOpenAIModel(model)) {
    return enforcePoliteRomanHindi(await translateWithOpenAI(englishScript, prompt, model));
  }
  if (model === "gemini") {
    return enforcePoliteRomanHindi(await translateWithGemini(englishScript, prompt));
  }
  if (model === SARVAM_MAYURA_MODEL) {
    return enforcePoliteRomanHindi(await translateWithSarvam(englishScript, {
      outputScript: "roman",
      mode: "modern-colloquial",
    }));
  }
  throw new Error(`Unsupported translation model: ${model}`);
}

function enforcePoliteRomanHindi(text) {
  const replacements = [
    [/\bkar\s+do\b/gi, "kar dijiye"],
    [/\bkar\s+lo\b/gi, "kar lijiye"],
    [/\bde\s+do\b/gi, "de dijiye"],
    [/\bdaal\s+do\b/gi, "daal dijiye"],
    [/\bbhar\s+do\b/gi, "bhar dijiye"],
    [/\butha\s+lo\b/gi, "utha lijiye"],
    [/\bhata\s+do\b/gi, "hata dijiye"],
    [/\bkaro\b/gi, "kijiye"],
    [/\bdaalo\b/gi, "daal dijiye"],
    [/\bdedo\b/gi, "de dijiye"],
    [/\bbharo\b/gi, "bhar dijiye"],
    [/\buthaao\b/gi, "utha dijiye"],
    [/\bhatao\b/gi, "hata dijiye"],
    [/\brakho\b/gi, "rakh dijiye"],
    [/\bnikalo\b/gi, "nikaal dijiye"],
    [/\bdekho\b/gi, "dekhiye"],
    [/\bsuno\b/gi, "suniye"],
    [/\baao\b/gi, "aaiye"],
  ];

  return replacements.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}

export async function translateToDevanagari(romanScript, model = "openai") {
  if (isOpenAIModel(model)) {
    return translateWithOpenAI(romanScript, ROMAN_TO_DEVANAGARI_PROMPT, model);
  }
  if (model === "gemini") {
    return translateWithGemini(romanScript, ROMAN_TO_DEVANAGARI_PROMPT);
  }
  if (model === SARVAM_MAYURA_MODEL) {
    return transliterateWithSarvam(romanScript);
  }
  throw new Error(`Unsupported translation model: ${model}`);
}

function getSarvamHeaders() {
  if (!process.env.SARVAM_API_KEY) throw new Error("SARVAM_API_KEY not set");
  return {
    "api-subscription-key": process.env.SARVAM_API_KEY,
    "Content-Type": "application/json",
  };
}

async function translateWithSarvam(text, { outputScript, mode }) {
  const chunks = splitIntoChunks(text, 1000);
  const results = [];

  for (const chunk of chunks) {
    const response = await axios.post(
      `${SARVAM_API_URL}/translate`,
      {
        input: chunk,
        source_language_code: "en-IN",
        target_language_code: "hi-IN",
        model: "mayura:v1",
        mode,
        output_script: outputScript,
        numerals_format: "international",
      },
      { headers: getSarvamHeaders(), timeout: 60000 }
    );
    results.push(response.data.translated_text?.trim() || "");
  }

  return results.join("\n");
}

async function transliterateWithSarvam(text) {
  const chunks = splitIntoChunks(text, 1000);
  const results = [];

  for (const chunk of chunks) {
    const response = await axios.post(
      `${SARVAM_API_URL}/transliterate`,
      {
        input: chunk,
        source_language_code: "en-IN",
        target_language_code: "hi-IN",
        numerals_format: "international",
        spoken_form: false,
      },
      { headers: getSarvamHeaders(), timeout: 60000 }
    );
    results.push(response.data.transliterated_text?.trim() || "");
  }

  return results.join("\n");
}

async function translateWithOpenAI(text, systemPrompt, model) {
  const client = getOpenAIClient();
  const modelId = OPENAI_MODELS[model] || "gpt-4o-mini";
  const isGpt56 = modelId.startsWith("gpt-5.6");

  const chunks = splitIntoChunks(text, 3000);
  const results = [];

  for (const chunk of chunks) {
    const params = {
      model: modelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: chunk }
      ],
    };
    // GPT-5.6 family: no temperature override, uses max_completion_tokens
    if (isGpt56) {
      params.max_completion_tokens = 8192;
    } else {
      params.temperature = 0.3;
      params.max_tokens = 4096;
    }
    const response = await client.chat.completions.create(params);
    results.push(response.choices[0].message.content.trim());
  }

  return results.join("\n");
}

async function translateWithGemini(text, systemPrompt) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");

  const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
  const chunks = splitIntoChunks(text, 3000);
  const results = [];

  let workingModel = null;
  for (const chunk of chunks) {
    const modelsToTry = workingModel ? [workingModel] : MODELS;
    const errors = [];
    let succeeded = false;

    for (const model of modelsToTry) {
      try {
        console.log(`[gemini] Trying model: ${model}`);
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            contents: [{
              parts: [{ text: `${systemPrompt}\n\n${chunk}` }]
            }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
          },
          { headers: { "Content-Type": "application/json" }, timeout: 60000 }
        );
        const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        results.push(content.trim());
        workingModel = model;
        console.log(`[gemini] ✓ ${model} responded: ${content.length} chars`);
        succeeded = true;
        break;
      } catch (err) {
        const status = err.response?.status;
        const msg = status === 429
          ? "rate limit / quota exceeded"
          : (err.response?.data?.error?.message || err.message).slice(0, 120);
        errors.push(`${model}: ${status || ""} ${msg}`);
        console.log(`[gemini] ✗ ${model} failed: ${status || err.message}`);
      }
    }

    if (!succeeded) {
      const quotaHit = errors.some((e) => e.includes("quota"));
      throw new Error(
        (quotaHit ? "Gemini quota/rate limit exceeded — wait a bit or check your Gemini API plan. " : "Gemini API failed. ") +
        `Details: ${errors.join(" | ")}`
      );
    }
  }

  return results.join("\n");
}

function splitIntoChunks(text, maxChars) {
  const lines = text.split("\n");
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const line of lines) {
    if (currentLen + line.length > maxChars && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += line.length + 1;
  }

  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

export const TONE_PROFILES = {
  empathy: {
    name: "Empathy — Warm & Organized",
    description: "30-40 years old. Tone is warm, expressive, but highly organized and firm. Speaks with a natural flow, connecting sentences smoothly.",
    suggestedVoices: {
      sarvam: { v3: "priya", v2: "anushka" },
      azure: "hi-IN-SwaraNeural",
      google: "hi-IN-Neural2-A",
      gemini: "Aoede",
      openai: "nova",
      elevenlabs: "21m00Tcm4TlvDq8ikWAM",
    }
  },
  authority: {
    name: "Authority — Firm & Professional",
    description: "35-50 years old. Tone is commanding but respectful. Clear diction, measured pace.",
    suggestedVoices: {
      sarvam: { v3: "shubh", v2: "arya" },
      azure: "hi-IN-MadhurNeural",
      google: "hi-IN-Neural2-C",
      gemini: "Charon",
      openai: "onyx",
      elevenlabs: "ErXwobaYiN019PkySvjV",
    }
  },
  gentle: {
    name: "Gentle — Soft & Caring",
    description: "25-35 years old. Tone is gentle, patient, encouraging. Like a supportive team lead.",
    suggestedVoices: {
      sarvam: { v3: "ishita", v2: "manisha" },
      azure: "hi-IN-SwaraNeural",
      google: "hi-IN-Neural2-A",
      gemini: "Leda",
      openai: "shimmer",
      elevenlabs: "EXAVITQu4vr4xnSDxMaL",
    }
  },
  neutral: {
    name: "Neutral — Clear & Standard",
    description: "Standard professional tone. Clear, no strong emotion.",
    suggestedVoices: {
      sarvam: { v3: "mani", v2: "karun" },
      azure: "hi-IN-MadhurNeural",
      google: "hi-IN-Neural2-C",
      gemini: "Puck",
      openai: "alloy",
      elevenlabs: "pNInz6obpgDQGcFmaJgB",
    }
  }
};

export function getSuggestedVoice(toneKey, provider, model) {
  const tone = TONE_PROFILES[toneKey] || TONE_PROFILES.empathy;
  const voices = tone.suggestedVoices;

  if (provider === "sarvam") {
    const sarvamVoices = voices.sarvam || {};
    if (model === "bulbul:v2") return sarvamVoices.v2 || "anushka";
    return sarvamVoices.v3 || "priya";
  }

  return voices[provider] || null;
}
