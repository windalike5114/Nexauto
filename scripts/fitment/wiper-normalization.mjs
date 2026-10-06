export const FRONT_WIPER_LENGTHS_IN = Object.freeze([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30
]);

export const REAR_WIPER_LENGTHS_IN = Object.freeze([
  8, 10, 11, 12, 13, 14, 15, 16
]);

const FRONT_LENGTH_SET = new Set(FRONT_WIPER_LENGTHS_IN);
const REAR_LENGTH_SET = new Set(REAR_WIPER_LENGTHS_IN);

// Catalogue millimetre values are nominal product sizes, not mathematical
// conversions. Keep the accepted aliases explicit so an unexpected value is
// reviewed instead of silently rounded to a saleable blade size.
const MILLIMETRE_ALIASES = new Map([
  [200, 8],
  [203, 8],
  [250, 10],
  [254, 10],
  [255, 10],
  [275, 11],
  [280, 11],
  [300, 12],
  [305, 12],
  [325, 13],
  [330, 13],
  [350, 14],
  [355, 14],
  [356, 14],
  [375, 15],
  [380, 15],
  [381, 15],
  [400, 16],
  [405, 16],
  [406, 16],
  [425, 17],
  [430, 17],
  [432, 17],
  [450, 18],
  [455, 18],
  [457, 18],
  [475, 19],
  [480, 19],
  [483, 19],
  [500, 20],
  [505, 20],
  [508, 20],
  [510, 20],
  [525, 21],
  [530, 21],
  [533, 21],
  [550, 22],
  [555, 22],
  [559, 22],
  [600, 24],
  [605, 24],
  [610, 24],
  [650, 26],
  [655, 26],
  [660, 26],
  [700, 28],
  [705, 28],
  [710, 28],
  [711, 28],
  [750, 30],
  [755, 30],
  [760, 30],
  [762, 30]
]);

export function normalizeWiperLength(value, position) {
  const raw = cleanText(value);
  if (!raw) return { value: null, raw, issue: null };

  const match = raw.match(/\d+(?:\.\d+)?/);
  if (!match) {
    return {
      value: null,
      raw,
      issue: `Could not parse ${position} wiper length: ${raw}`
    };
  }

  const parsed = Number(match[0]);
  const isMillimetres = /(?:mm|毫米)/i.test(raw);
  const lengthIn = isMillimetres ? MILLIMETRE_ALIASES.get(parsed) : parsed;

  if (isMillimetres && lengthIn === undefined) {
    return {
      value: null,
      raw,
      issue: `Unmapped ${position} millimetre wiper length: ${raw}`
    };
  }

  const allowed = position === "rear" ? REAR_LENGTH_SET : FRONT_LENGTH_SET;
  if (!Number.isInteger(lengthIn) || !allowed.has(lengthIn)) {
    return {
      value: null,
      raw,
      issue: `Unsupported ${position} wiper length: ${raw}`
    };
  }

  return { value: lengthIn, raw, issue: null };
}

export function allowedWiperLengths(position) {
  return position === "rear" ? [...REAR_WIPER_LENGTHS_IN] : [...FRONT_WIPER_LENGTHS_IN];
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFKC").replace(/\s+/g, " ").trim();
}
