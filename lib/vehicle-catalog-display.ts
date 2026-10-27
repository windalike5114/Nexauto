type SourceModel = { id: string; name: string; years: number[] };
export type CatalogModelGroup = SourceModel & { modelIds: string[]; aliases: string[] };

// Market names already paired in the maintained NexAuto vehicle-family catalogue.
// Performance derivatives and distinct body/model families remain separate.
const aliases: Record<string, string[][]> = {
  TOYOTA: [["VITZ", "YARIS"], ["HIGHLANDER", "KLUGER"]],
  HONDA: [["FIT", "JAZZ"]],
  MAZDA: [["DEMIO", "2"], ["AXELA", "3"], ["ATENZA", "MAZDA6", "6"], ["PREMACY", "5"]],
  NISSAN: [["QASHQAI", "DUALIS"]]
};
const familyLabels: Record<string, string> = {
  "TOYOTA:VITZ": "Vitz / Yaris", "TOYOTA:HIGHLANDER": "Highlander / Kluger",
  "HONDA:FIT": "Fit / Jazz", "MAZDA:DEMIO": "Demio / Mazda 2", "MAZDA:AXELA": "Axela / Mazda 3",
  "MAZDA:ATENZA": "Atenza / Mazda 6", "MAZDA:PREMACY": "Premacy / Mazda 5", "NISSAN:QASHQAI": "Qashqai / Dualis"
};
export function vehicleLabelKey(value: string) {
  // '+' is significant (for example Wagon R and Wagon R+).
  return value.normalize("NFKC").toUpperCase().replace(/[\s-]+/g, "");
}
export function groupCatalogModels(make: string, models: SourceModel[]): CatalogModelGroup[] {
  const families = aliases[make.toUpperCase()] ?? [];
  const grouped = new Map<string, SourceModel[]>();
  for (const model of models) {
    const family = families.find((names) => names.some((name) => vehicleLabelKey(name) === vehicleLabelKey(model.name)));
    const key = family ? family[0] : vehicleLabelKey(model.name);
    grouped.set(key, [...(grouped.get(key) ?? []), model]);
  }
  return [...grouped.values()].map((members) => {
    const family = families.find((names) => names.some((name) => members.some((member) => vehicleLabelKey(name) === vehicleLabelKey(member.name))));
    const ordered = [...members].sort((a, b) => {
      if (family) return family.findIndex((name) => vehicleLabelKey(name) === vehicleLabelKey(a.name)) - family.findIndex((name) => vehicleLabelKey(name) === vehicleLabelKey(b.name));
      return a.name.length - b.name.length || a.id.localeCompare(b.id);
    });
    const names = [...new Set(ordered.map((row) => row.name))];
    return { id: ordered[0].id, name: family && names.length > 1 ? familyLabels[`${make.toUpperCase()}:${family[0]}`] : ordered[0].name,
      years: [...new Set(members.flatMap((row) => row.years))].sort((a, b) => b - a),
      modelIds: [...new Set(members.map((row) => row.id))].sort(), aliases: names };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export type GroupedOption = { id: string; name: string; ids: string[] };
export function groupIdenticalOptions(options: { id: string; name: string }[]): GroupedOption[] {
  const grouped = new Map<string, GroupedOption>();
  for (const option of options) {
    const key = vehicleLabelKey(option.name);
    const entry = grouped.get(key) ?? { ...option, ids: [] };
    if (!entry.ids.includes(option.id)) entry.ids.push(option.id);
    grouped.set(key, entry);
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function engineLabelWithCodes(display: string, raw: string) {
  const match = raw.match(/^\s*\d+(?:\.\d+)?\s*L\s+(.+?)(?=\s+(?:DOHC|SOHC|OHC|OHV|\d+V|PETROL|DIESEL|ELECTRIC|HYBRID|TURBO|SUPERCHARGED)\b)/i);
  if (!match) return raw.trim() || display;
  const code = match[1].split(/[,/]/).map((part) => part.trim()).filter(Boolean).join(" / ");
  return `${display.split(" — ")[0]} — ${code}`;
}
