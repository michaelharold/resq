/**
 * ResQ keyword-rules triage — the fallback when Ollama is slow, unreachable, returns
 * invalid JSON or is unsure (README §4, CONTRACTS §7 "lib/triage-rules.ts").
 *
 * `triageByRules(text)` is pure, synchronous, never throws and returns in microseconds:
 * a handful of anchored, backtracking-free regexes over a normalised string.
 *
 * Algorithm
 * 1. Normalise: lowercase, drop apostrophes ("can't" → "cant"), turn every other
 *    punctuation mark into a space, collapse whitespace. Latin and Malayalam letters
 *    survive; only Manglish (Latin-script Malayalam) is matched, which is what people in
 *    Kollam actually type in a hurry.
 * 2. Score every NeedType from RULES: each `{ pattern, weight }` that matches adds its
 *    weight. Multi-word phrases weigh 3 (PHRASE), single words 1–2.
 * 3. Winner = highest score; ties → the type with the more urgent default urgency, then
 *    taxonomy order.
 * 4. Combination rule (README §3 example "Water is rising, my grandmother can't walk"):
 *    when BOTH flood_rescue and evacuation_mobility scored AND a mobility/vulnerability
 *    word (MOBILITY) is present, the type is evacuation_mobility even if the flood score
 *    is higher — the person is not asking for a swim, they need to be carried out.
 * 5. Confidence (CONTRACTS §7): no hit → other / high / 0.2; winning type's total weight
 *    < 2 → 0.45; 2–3 → 0.6; ≥ 4 or any phrase (weight ≥ 3) hit → 0.8.
 * 6. Urgency: "critical" when any CRITICAL phrase appears anywhere in the text, else the
 *    type's default (TYPE_DEFAULT_URGENCY); the no-hit case is "high" so an unreadable
 *    plea still gets a fast wave.
 * 7. skills = TYPE_SKILLS[type] (copied); summary = TYPE_LABELS[type] + ": " + first ~80
 *    chars of the cleaned text; clarifyingQuestion = CLARIFYING_QUESTION iff confidence
 *    < 0.5 (it never blocks dispatch — CONTRACTS §6).
 */
import { NO_HAZARD } from "./hazards";
import type { NeedType, TriageResult, Urgency } from "./types";
import { CLARIFYING_QUESTION, NEED_TYPES, TYPE_LABELS, TYPE_SKILLS, URGENCIES } from "./taxonomy";

type Rule = { pattern: RegExp; weight: number };

/** Weight of a multi-word phrase; any hit at or above this counts as a "phrase hit". */
const PHRASE = 3;

/** Longest input we bother scanning; anything past this cannot change a keyword decision. */
const MAX_SCAN_CHARS = 4000;

/** Length of the description excerpt used in the summary. */
const SUMMARY_CHARS = 80;

const NO_HIT_CONFIDENCE = 0.2;
const WEAK_CONFIDENCE = 0.45;
const MEDIUM_CONFIDENCE = 0.6;
const STRONG_CONFIDENCE = 0.8;
const CLARIFY_BELOW = 0.5;

/** "cant" is what normalisation turns "can't" into; the other spellings are typed as-is. */
const CANT = "(?:cant|cannot|can not|couldnt|could not|unable to|not able to)";

/** Word-bounded alternation. No `g` flag, so `.test()` carries no lastIndex state. */
function re(alternatives: string): RegExp {
  return new RegExp(`\\b(?:${alternatives})\\b`);
}

function rule(alternatives: string, weight: number): Rule {
  return { pattern: re(alternatives), weight };
}

/**
 * Keyword table. Single words: 1 (weak / ambiguous) or 2 (strong). Phrases: PHRASE (3).
 * Manglish entries are marked with the Malayalam meaning.
 */
const RULES: Record<NeedType, Rule[]> = {
  flood_rescue: [
    rule("flood|flooded|flooding|floods", 2),
    rule("vellapokkam|vellappokkam", 2), // flood
    rule("vellam|vellom", 2), // water
    rule("boat|boats|vallam", 2), // vallam = boat
    rule("drowning|drowned|drown", 2),
    rule("submerged|underwater|overflowing|overflow", 2),
    rule("water", 1),
    rule("rising|swim|current|river|canal|dam", 1),
    rule("water (?:is |level )?(?:rising|coming|entering|increasing|rose)", PHRASE),
    rule("rising (?:flood )?water|water rising fast|water till (?:neck|chest|waist)", PHRASE),
    rule("water (?:inside|in|entered|entering) (?:the |my |our )?(?:house|home|room)", PHRASE),
    rule("house (?:is )?flooded|home (?:is )?flooded|road (?:is )?flooded", PHRASE),
    rule("(?:on|at) the (?:roof|terrace)|stuck on (?:the )?(?:roof|terrace)", PHRASE),
    rule("swept away|washed away|need (?:a )?boat|vellam keri|vellam kayari", PHRASE), // vellam keri = water came in
  ],
  cardiac_no_breathing: [
    rule("unconscious|unresponsive|collapsed|fainted|cpr|cardiac", 2),
    rule("heart|pulse|breathing|breath|shwasam|swasam", 1), // shwasam = breath
    rule("not breathing|no breathing|isnt breathing|stopped breathing|breathing illa|breathing stopped", PHRASE),
    rule("shwasam illa|swasam illa|shwasam kittunnilla|swasam kittunnilla|shwasam mutti|swasam mutti", PHRASE), // no breath
    rule(`${CANT} breathe|no pulse|heart attack|chest pain|nenju vedana|passed out|not waking up|wont wake up|bodham illa`, PHRASE), // nenju vedana = chest pain, bodham illa = unconscious
    rule("breathing (?:difficulty|trouble|problem)|difficulty breathing|trouble breathing|short of breath|shortness of breath", PHRASE),
  ],
  bleeding: [
    rule("bleeding|bleeds|bleed|blood|wound|wounded|stabbed|stab|gash|laceration", 2),
    rule("raktham|rektham|chora|choora|murivu", 2), // raktham/chora = blood, murivu = wound
    rule("cut|injured|injury|accident", 1),
    rule("heavy bleeding|bleeding a lot|bleeding heavily|bleeding badly|lot of blood|lots of blood|too much blood", PHRASE),
    rule("deep cut|wont stop bleeding|not stopping|blood (?:is )?(?:coming|pouring|flowing)|chora varunnu|raktham varunnu", PHRASE), // chora varunnu = blood is coming
  ],
  fracture: [
    rule("fracture|fractured|broken|bone|bones|dislocated|dislocation", 2),
    rule("ellu|odinju|pottiyo|pottipoyi", 2), // ellu = bone, odinju = broke
    rule("bent|twisted", 2),
    rule("broke|fell|fall|sprain|sprained|swollen|swelling|bike|scooter|ladder", 1),
    rule("kaal odinju|kai odinju|ellu odinju|ellu potti", PHRASE), // leg/arm/bone broke
    rule("fell (?:from|off|down)|fallen (?:from|off|down)", PHRASE),
    rule("(?:leg|arm|hand|foot|ankle|wrist|hip|bone) (?:is )?(?:bent|broken|twisted|swollen)|broken (?:leg|arm|hand|foot|bone|hip)", PHRASE),
  ],
  electrical: [
    rule("electrocuted|electrocution|electric|electrical|electricity|shock|wire|wires|sparks|sparking|transformer", 2),
    rule("current|kambi|fuse|socket|plug|voltage|shocked", 1), // kambi = wire
    rule("live wire|short circuit|meter box|power line|electric pole|current pole|got (?:a |an )?(?:electric )?shock", PHRASE),
    rule("current adichu|shock adichu|current kayari|electric shock", PHRASE), // adichu = got hit
    rule("wire (?:is )?(?:down|fallen|hanging|broken)|fallen (?:wire|line|pole)", PHRASE),
  ],
  fire: [
    rule("fire|fires|smoke|burning|flames|flame|blaze|explosion|exploded", 2),
    rule("thee|theeyanu|theepiduthu|theepiduttham|kathunnu|puka", 2), // thee = fire, kathunnu = burning, puka = smoke
    rule("burn|burnt|burned|burns|gas", 1),
    rule("on fire|caught fire|fire spreading|gas leak|gas leaking|cylinder (?:blast|burst|exploded)|house (?:is )?burning", PHRASE),
    rule("thee pidichu|thee padarunnu|thee aanu|puka varunnu", PHRASE), // fire caught / spreading / smoke coming
  ],
  trapped_structural: [
    rule("trapped|rubble|debris|buried|landslide|landslip|collapse|pinned", 2),
    rule("kudungi|kudungiyirikkunnu|kudungippoyi|mannidichil|urulpottal", 2), // kudungi = stuck/trapped, mannidichil = landslide
    rule("stuck|crushed|wall|roof|ceiling|building|under", 1),
    rule("(?:building|house|wall|roof|ceiling|bridge|tree|slab) (?:has )?(?:collapsed|fell|fallen|came down|caved in)", PHRASE),
    rule(`trapped (?:under|inside|in|between)|stuck under|buried under|${CANT} get out|${CANT} come out|no way out`, PHRASE),
    rule("under (?:the )?(?:rubble|debris|wall|roof|building|tree)|mannu idinju|veedu idinju", PHRASE), // mannu idinju = earth collapsed, veedu idinju = house collapsed
  ],
  snakebite: [
    rule("snake|snakebite|cobra|viper|krait|venom|venomous", 2),
    rule("paambu|pambu|pamb|paamb|aravam", 2), // paambu = snake
    rule("bite|bitten|kadichu|kadi", 1), // kadichu = bit
    rule("snake bite|snake bit|bitten by (?:a )?snake|bit by (?:a )?snake|snake (?:has )?bitten", PHRASE),
    rule("paambu kadichu|pambu kadichu|paambu kadi|pambu kadi|paamb kadichu|pamb kadichu", PHRASE),
  ],
  evacuation_mobility: [
    rule("evacuate|evacuation|wheelchair|bedridden|paralysed|paralyzed|paralysis|pregnant|disabled|stretcher|ambulance|newborn|dialysis", 2),
    rule("muthassi|muthassan|ammoomma|ammumma|appooppan|appuppan|vayasan|vayasayi|garbhini", 2), // grandma / grandpa / old / pregnant
    rule("grandmother|grandfather|granny|grandma|grandpa|elderly|baby|infant|patient|carry|shift|vehicle|transport|amma|achan|ammachi|achachan", 1),
    rule("(?<!year )(?<!years )(?<!yr )(?<!yrs )old", 1), // "old lady" yes, "6 year old" no
    rule(`${CANT} walk|${CANT} move|${CANT} stand|${CANT} climb|not walking|nadakkan pattilla|nadakkan vayya|anangan pattilla`, PHRASE), // nadakkan pattilla = can't walk
    rule("bed ridden|ground floor|stuck on (?:the )?(?:\\w+ )?floor|on (?:the )?ground floor|need (?:a |an )?(?:vehicle|ambulance|transport|jeep|car)", PHRASE),
    rule("old (?:man|woman|lady|people|person|mother|father|age|aged)|very old|too old|(?:move|shift|carry) (?:him|her|them|the patient|my mother|my father)", PHRASE),
  ],
  supplies_oxygen_meds: [
    rule("oxygen|medicine|medicines|meds|medication|medications|insulin|inhaler|asthma|generator|supplies|marunnu", 2), // marunnu = medicine
    rule("tablets|tablet|prescription|pharmacy|cylinder|food|milk|diapers|sanitary|candles|torch|ration|diabetic|nebulizer|nebuliser", 1),
    rule("oxygen cylinder|oxygen (?:is )?(?:over|finished|running out|low|empty)|need oxygen|o2 cylinder", PHRASE),
    rule("drinking water|no food|baby food|no water to drink|power cut|no power|no electricity|no current|current illa|current poyi", PHRASE),
    rule("(?:bp|sugar|heart|pressure|thyroid|epilepsy) (?:medicine|tablets|tablet|meds)|medicine (?:is )?(?:over|finished|out)|marunnu illa|marunnu theernnu", PHRASE), // marunnu theernnu = medicine finished
  ],
  missing_person: [
    rule("missing|disappeared|wandered|lost", 2),
    rule("kaanunilla|kaanunnilla|kanunilla|kanunnilla|kaanmanilla|kanmanilla|kaanilla|kanilla", 2), // can't see / not found
    rule("search|searching|find|dementia|unreachable", 1),
    rule(`is missing|are missing|went missing|gone missing|${CANT} find|not found|nowhere|last seen`, PHRASE),
    rule("not (?:come|came) back|hasnt come back|havent come back|didnt (?:come|return)|not returned|no contact|not reachable|not answering|kaanan illa|kanan illa|kaanaanilla", PHRASE),
    rule("since (?:morning|evening|night|noon|afternoon|yesterday|last night|hours|\\d+ hours)", 2),
  ],
  other: [],
};

/**
 * Mobility / vulnerability words for the flood + mobility combination rule (step 4 in the
 * header). Kept as one regex so the rule reads as a single test.
 */
const MOBILITY = re(
  [
    `${CANT} walk`,
    `${CANT} move`,
    `${CANT} stand`,
    "not walking",
    "wheelchair",
    "bedridden",
    "bed ridden",
    "paralysed",
    "paralyzed",
    "paralysis",
    "grandmother",
    "grandfather",
    "granny",
    "grandma",
    "grandpa",
    "elderly",
    "(?<!year )(?<!years )(?<!yr )(?<!yrs )old",
    "baby",
    "infant",
    "newborn",
    "pregnant",
    "disabled",
    "patient",
    "dialysis",
    "stretcher",
    "stuck on (?:the )?(?:\\w+ )?floor",
    "muthassi",
    "muthassan",
    "ammoomma",
    "ammumma",
    "appooppan",
    "appuppan",
    "vayasan",
    "vayasayi",
    "garbhini",
    "nadakkan pattilla",
    "nadakkan vayya",
  ].join("|"),
);

/**
 * Phrases that force urgency "critical" regardless of type (CONTRACTS §7 list plus the
 * obvious spellings and Manglish forms). "water (is) rising" is included without "fast":
 * README §3 classifies "Water is rising, my grandmother can't walk" as critical.
 */
const CRITICAL = re(
  [
    "not breathing",
    "no breathing",
    "isnt breathing",
    "stopped breathing",
    "breathing illa",
    "shwasam illa",
    "swasam illa",
    `${CANT} breathe`,
    "unconscious",
    "unresponsive",
    "bodham illa",
    "collapsed",
    "no pulse",
    "heart attack",
    "chest pain",
    "nenju vedana",
    "passed out",
    "not waking up",
    "drowning",
    "drowned",
    "swept away",
    "washed away",
    "water rising fast",
    "water (?:is |level )?(?:rising|coming|entering|increasing)",
    "rising (?:flood )?water",
    "trapped",
    "kudungi",
    "buried",
    "landslide",
    "mannidichil",
    "fire",
    "on fire",
    "thee",
    "theepiduthu",
    "gas leak",
    "explosion",
    "heavy bleeding",
    "bleeding a lot",
    "bleeding heavily",
    "bleeding badly",
    "wont stop bleeding",
    "electrocuted",
    "current adichu",
    "shock adichu",
    "snake bite",
    "snake bit",
    "snakebite",
    "bitten by (?:a )?snake",
    "paambu kadichu",
    "pambu kadichu",
  ].join("|"),
);

/** Default urgency per type when no CRITICAL phrase is present (CONTRACTS §7). */
export const TYPE_DEFAULT_URGENCY: Record<NeedType, Urgency> = {
  cardiac_no_breathing: "critical",
  fire: "critical",
  flood_rescue: "critical",
  trapped_structural: "critical",
  snakebite: "critical",
  electrical: "critical",
  bleeding: "high",
  evacuation_mobility: "high",
  missing_person: "high",
  fracture: "medium",
  supplies_oxygen_meds: "medium",
  other: "medium",
};

/**
 * Lowercase, drop apostrophes (so "can't" → "cant", "won't" → "wont"), replace every other
 * punctuation mark with a space, collapse whitespace, trim. Exported for tests and for the
 * landmark matcher to reuse if it wants identical behaviour.
 */
export function normalizeText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .slice(0, MAX_SCAN_CHARS)
    .toLowerCase()
    .replace(/['‘’ʼ]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

type Score = { total: number; phrase: boolean };

function scoreType(text: string, rules: Rule[]): Score {
  let total = 0;
  let phrase = false;
  for (const r of rules) {
    if (r.pattern.test(text)) {
      total += r.weight;
      if (r.weight >= PHRASE) phrase = true;
    }
  }
  return { total, phrase };
}

/** Lower index = more urgent; used to break score ties in favour of the more urgent type. */
function urgencyRank(t: NeedType): number {
  return URGENCIES.indexOf(TYPE_DEFAULT_URGENCY[t]);
}

function pickType(scores: Record<NeedType, Score>): NeedType | null {
  let best: NeedType | null = null;
  for (const t of NEED_TYPES) {
    const s = scores[t].total;
    if (s <= 0) continue;
    if (best === null) {
      best = t;
      continue;
    }
    const b = scores[best].total;
    if (s > b || (s === b && urgencyRank(t) < urgencyRank(best))) best = t;
  }
  return best;
}

function confidenceFor(s: Score): number {
  if (s.phrase || s.total >= 4) return STRONG_CONFIDENCE;
  if (s.total >= 2) return MEDIUM_CONFIDENCE;
  return WEAK_CONFIDENCE;
}

function summaryFor(type: NeedType, cleaned: string): string {
  const label = TYPE_LABELS[type];
  if (cleaned.length === 0) return label;
  const excerpt = cleaned.length > SUMMARY_CHARS ? `${cleaned.slice(0, SUMMARY_CHARS).trimEnd()}…` : cleaned;
  return `${label}: ${excerpt}`;
}

function build(type: NeedType, urgency: Urgency, confidence: number, cleaned: string): TriageResult {
  return {
    type,
    urgency,
    skills: [...TYPE_SKILLS[type]],
    summary: summaryFor(type, cleaned),
    confidence,
    source: "rules",
    clarifyingQuestion: confidence < CLARIFY_BELOW ? CLARIFYING_QUESTION : null,
    equipment: [],
    hazardAlert: NO_HAZARD,
  };
}

function noHit(cleaned: string): TriageResult {
  // Unreadable plea: still dispatch generalists fast and ask the one fixed question.
  return build("other", "high", NO_HIT_CONFIDENCE, cleaned);
}

/**
 * Keyword-rules triage (README §4 fallback). Pure, synchronous, never throws.
 * Any non-string or empty input yields the no-hit result (`other` / `high` / 0.2).
 */
export function triageByRules(text: string): TriageResult {
  let cleaned = "";
  try {
    cleaned = normalizeText(text);
    if (cleaned.length === 0) return noHit(cleaned);

    const scores = {} as Record<NeedType, Score>;
    for (const t of NEED_TYPES) scores[t] = scoreType(cleaned, RULES[t]);

    let type = pickType(scores);
    if (type === null) {
      // No keyword hit; a critical phrase alone (unlikely, they are all keywords too) still lifts urgency.
      const r = noHit(cleaned);
      return CRITICAL.test(cleaned) ? { ...r, urgency: "critical" } : r;
    }

    // Combination rule (README §3): flood + mobility words → evacuation, not a swim.
    if (
      scores.flood_rescue.total > 0 &&
      scores.evacuation_mobility.total > 0 &&
      MOBILITY.test(cleaned)
    ) {
      type = "evacuation_mobility";
    }

    const urgency: Urgency = CRITICAL.test(cleaned) ? "critical" : TYPE_DEFAULT_URGENCY[type];
    return build(type, urgency, confidenceFor(scores[type]), cleaned);
  } catch {
    // Defensive only: nothing above should throw, but the fallback must never fail the request.
    return noHit(cleaned);
  }
}
