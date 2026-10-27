import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";

// User-maintained New Zealand popular-vehicle groups. A group may contain
// multiple market names that should be reported together, while the coverage
// denominator still counts every NexAuto application/year below those names.
export const REQUESTED_POPULAR_VEHICLE_GROUPS = [
  group(1, "Toyota Corolla", [["TOYOTA", "COROLLA"]]),
  group(2, "Ford Ranger", [["FORD", "RANGER"]]),
  group(3, "Toyota Hilux", [["TOYOTA", "HILUX"]]),
  group(4, "Toyota Aqua", [["TOYOTA", "AQUA"]]),
  group(5, "Suzuki Swift", [["SUZUKI", "SWIFT"]]),
  group(6, "Toyota RAV4", [["TOYOTA", "RAV4"]]),
  group(7, "Mazda Demio / Mazda 2", [["MAZDA", "DEMIO"], ["MAZDA", "2"]]),
  group(8, "Mitsubishi Outlander", [["MITSUBISHI", "OUTLANDER"]]),
  group(9, "Mazda CX-5", [["MAZDA", "CX-5"]]),
  group(10, "Toyota Prius", [["TOYOTA", "PRIUS"]]),
  group(11, "Nissan Leaf", [["NISSAN", "LEAF"]]),
  group(12, "Subaru Outback", [["SUBARU", "OUTBACK"]]),
  group(13, "Mitsubishi ASX", [["MITSUBISHI", "ASX"]]),
  group(14, "Holden Commodore", [["HOLDEN", "COMMODORE"]]),
  group(15, "Toyota Vitz / Yaris", [["TOYOTA", "VITZ"], ["TOYOTA", "YARIS"]]),
  group(16, "Honda Jazz / Fit", [["HONDA", "JAZZ"], ["HONDA", "FIT"]]),
  group(17, "Nissan X-Trail", [["NISSAN", "X-TRAIL"]]),
  group(18, "Hyundai Santa Fe", [["HYUNDAI", "SANTA FE"]]),
  group(19, "Mitsubishi Triton", [["MITSUBISHI", "TRITON"]]),
  group(20, "Subaru Forester", [["SUBARU", "FORESTER"]]),
  group(21, "Mazda 3 / Axela", [["MAZDA", "3"], ["MAZDA", "AXELA"]]),
  group(22, "Volkswagen Golf", [["VOLKSWAGEN", "GOLF"]]),
  group(23, "Toyota Camry", [["TOYOTA", "CAMRY"]]),
  group(24, "Kia Sportage", [["KIA", "SPORTAGE"]]),
  group(25, "Nissan Tiida", [["NISSAN", "TIIDA"]]),
  group(26, "Toyota Alphard / Vellfire", [["TOYOTA", "ALPHARD"], ["TOYOTA", "VELLFIRE"]]),
  group(27, "Toyota Hiace", [["TOYOTA", "HIACE"]]),
  group(28, "Ford Falcon", [["FORD", "FALCON"]]),
  group(29, "Tesla Model Y", [["TESLA", "MODEL Y"]]),
  group(30, "Isuzu D-Max", [["ISUZU", "D-MAX"]]),
  group(31, "Nissan Qashqai / Dualis", [["NISSAN", "QASHQAI"], ["NISSAN", "DUALIS"]]),
  group(32, "Kia Seltos", [["KIA", "SELTOS"]]),
  group(33, "Toyota Highlander / Kluger", [["TOYOTA", "HIGHLANDER"], ["TOYOTA", "KLUGER"]]),
  group(34, "Mitsubishi Eclipse Cross", [["MITSUBISHI", "ECLIPSE CROSS"]]),
  group(35, "Hyundai Tucson / ix35", [["HYUNDAI", "TUCSON"], ["HYUNDAI", "IX35"]]),
  group(36, "Mazda Premacy / Mazda 5", [["MAZDA", "PREMACY"], ["MAZDA", "5"]]),
  group(37, "Honda CR-V", [["HONDA", "CR-V"]]),
  group(38, "Toyota Land Cruiser Prado", [["TOYOTA", "LAND CRUISER PRADO"], ["TOYOTA", "PRADO"]]),
  group(39, "Suzuki Jimny", [["SUZUKI", "JIMNY"]]),
  group(40, "BMW 3 Series", [["BMW", "3 SERIES"]]),
  group(41, "BMW X5", [["BMW", "X5"]]),
  group(42, "MG ZS", [["MG", "ZS"]]),
  group(43, "Tesla Model 3", [["TESLA", "MODEL 3"]]),
  group(44, "Toyota Wish", [["TOYOTA", "WISH"]]),
  group(45, "Ford Focus", [["FORD", "FOCUS"]]),
  group(46, "Audi A4 / S4 Avant", [["AUDI", "A4"], ["AUDI", "S4"], ["AUDI", "S4 AVANT"]]),
  group(47, "Nissan Note", [["NISSAN", "NOTE"]]),
  group(48, "Mazda CX-3", [["MAZDA", "CX-3"]]),
  group(49, "Lexus RX", [["LEXUS", "RX"]]),
  group(50, "BYD Atto 3", [["BYD", "ATTO 3"]])
];

// 2000-2026 New Zealand light-fleet expansion calculated on 2026-10-25.
// Adding priorities 1-53 to the original 50 reaches 75.11% of the fleet.
export const POPULAR_75_ADDITIONAL_VEHICLE_GROUPS = [
  fleetGroup(51, 1, "Nissan Navara", [["NISSAN", "NAVARA"]], 51941),
  fleetGroup(52, 2, "Mazda Atenza / Mazda 6", [["MAZDA", "ATENZA"], ["MAZDA", "MAZDA6"], ["MAZDA", "6"]], 44904),
  fleetGroup(53, 3, "Subaru Impreza", [["SUBARU", "IMPREZA"]], 33970),
  fleetGroup(54, 4, "Holden Colorado", [["HOLDEN", "COLORADO"]], 33714),
  fleetGroup(55, 5, "Subaru Legacy", [["SUBARU", "LEGACY"]], 33534),
  fleetGroup(56, 6, "Toyota Land Cruiser", [["TOYOTA", "LANDCRUISER"], ["TOYOTA", "LAND CRUISER"]], 24847),
  fleetGroup(57, 7, "Mazda BT-50", [["MAZDA", "BT-50"]], 22299),
  fleetGroup(58, 8, "Honda Accord", [["HONDA", "ACCORD"]], 20381),
  fleetGroup(59, 9, "Toyota C-HR", [["TOYOTA", "C-HR"]], 20093),
  fleetGroup(60, 10, "Honda Civic", [["HONDA", "CIVIC"]], 19914),
  fleetGroup(61, 11, "Ford Transit", [["FORD", "TRANSIT"]], 17641),
  fleetGroup(62, 12, "Ford Escape / Kuga", [["FORD", "ESCAPE"], ["FORD", "KUGA"]], 17428),
  fleetGroup(63, 13, "Holden Captiva", [["HOLDEN", "CAPTIVA"], ["HOLDEN", "CAPTIVA 5"], ["HOLDEN", "CAPTIVA 7"]], 17185),
  fleetGroup(64, 14, "Volkswagen Tiguan", [["VOLKSWAGEN", "TIGUAN"]], 17107),
  fleetGroup(65, 15, "Subaru XV", [["SUBARU", "XV"]], 16925),
  fleetGroup(66, 16, "Suzuki Vitara / Grand Vitara", [["SUZUKI", "VITARA"], ["SUZUKI", "GRAND VITARA"]], 16425),
  fleetGroup(67, 17, "Honda HR-V / Vezel", [["HONDA", "HR-V"], ["HONDA", "VEZEL"]], 16335),
  fleetGroup(68, 18, "Nissan Serena", [["NISSAN", "SERENA"]], 15920),
  fleetGroup(69, 19, "MINI hatch family", [["BMW", "MINI"], ["MINI", "MINI"], ["MINI", "MINI COOPER"], ["MINI", "COOPER"], ["MINI", "HATCH"]], 15872, { bodyStyles: ["HATCHBACK"] }),
  fleetGroup(70, 20, "Mitsubishi Lancer", [["MITSUBISHI", "LANCER"]], 15424),
  fleetGroup(71, 21, "Toyota Estima", [["TOYOTA", "ESTIMA"]], 15343),
  fleetGroup(72, 22, "Hyundai Kona", [["HYUNDAI", "KONA"]], 14980),
  fleetGroup(73, 23, "Ford Everest", [["FORD", "EVEREST"]], 14972),
  fleetGroup(74, 24, "Hyundai i30", [["HYUNDAI", "I30"]], 14900),
  fleetGroup(75, 25, "Honda Odyssey", [["HONDA", "ODYSSEY"]], 14328),
  fleetGroup(76, 26, "Toyota Auris", [["TOYOTA", "AURIS"]], 14308),
  fleetGroup(77, 27, "Volkswagen Polo", [["VOLKSWAGEN", "POLO"]], 14156),
  fleetGroup(78, 28, "Suzuki SX4", [["SUZUKI", "SX4"]], 13784),
  fleetGroup(79, 29, "Nissan March / Micra", [["NISSAN", "MARCH"], ["NISSAN", "MICRA"]], 13220),
  fleetGroup(80, 30, "Nissan Caravan / NV350", [["NISSAN", "CARAVAN"], ["NISSAN", "NV350"], ["NISSAN", "NV350 CARAVAN"]], 12759),
  fleetGroup(81, 31, "Ford Mondeo", [["FORD", "MONDEO"]], 12243),
  fleetGroup(82, 32, "Mitsubishi Pajero", [["MITSUBISHI", "PAJERO"]], 12112),
  fleetGroup(83, 33, "Toyota Blade", [["TOYOTA", "BLADE"]], 12050),
  fleetGroup(84, 34, "Toyota Yaris Cross", [["TOYOTA", "YARIS CROSS"]], 11526),
  fleetGroup(85, 35, "Mitsubishi Colt", [["MITSUBISHI", "COLT"]], 11502),
  fleetGroup(86, 36, "Mazda MPV", [["MAZDA", "MPV"]], 11045),
  fleetGroup(87, 37, "Kia Sorento", [["KIA", "SORENTO"]], 10690),
  fleetGroup(88, 38, "Nissan Skyline", [["NISSAN", "SKYLINE"]], 10538),
  fleetGroup(89, 39, "Kia Stonic", [["KIA", "STONIC"]], 10456),
  fleetGroup(90, 40, "Ford Territory", [["FORD", "TERRITORY"]], 10217),
  fleetGroup(91, 41, "Audi A3", [["AUDI", "A3"]], 10117),
  fleetGroup(92, 42, "Toyota Mark X", [["TOYOTA", "MARK X"], ["TOYOTA", "MARKX"]], 9885),
  fleetGroup(93, 43, "Nissan Juke", [["NISSAN", "JUKE"]], 9841),
  fleetGroup(94, 44, "Toyota ist", [["TOYOTA", "IST"]], 9646),
  fleetGroup(95, 45, "Kia Rio", [["KIA", "RIO"]], 9522),
  fleetGroup(96, 46, "Holden Cruze", [["HOLDEN", "CRUZE"]], 9430),
  fleetGroup(97, 47, "Volkswagen Amarok", [["VOLKSWAGEN", "AMAROK"]], 9236),
  fleetGroup(98, 48, "Ford Fiesta", [["FORD", "FIESTA"]], 9138),
  fleetGroup(99, 49, "Toyota Vanguard", [["TOYOTA", "VANGUARD"]], 8939),
  fleetGroup(100, 50, "Ford Courier", [["FORD", "COURIER"]], 8661),
  fleetGroup(101, 51, "GWM / Haval H6", [["GWM", "HAVAL H6"], ["GWM", "H6"], ["HAVAL", "H6"]], 8578),
  fleetGroup(102, 52, "Honda Stream", [["HONDA", "STREAM"]], 8572),
  fleetGroup(103, 53, "Holden Rodeo", [["HOLDEN", "RODEO"]], 8534)
];

// Adding priorities 54-82 raises the same fleet scope to 80.12%.
export const POPULAR_80_ADDITIONAL_VEHICLE_GROUPS = [
  fleetGroup(104, 54, "Jeep Grand Cherokee", [["JEEP", "GRAND CHEROKEE"]], 8222),
  fleetGroup(105, 55, "Nissan Bluebird", [["NISSAN", "BLUEBIRD"]], 8194),
  fleetGroup(106, 56, "Toyota Avensis", [["TOYOTA", "AVENSIS"]], 8149),
  fleetGroup(107, 57, "Holden Barina", [["HOLDEN", "BARINA"]], 7916),
  fleetGroup(108, 58, "Suzuki Ignis", [["SUZUKI", "IGNIS"]], 7792),
  fleetGroup(109, 59, "Nissan Murano", [["NISSAN", "MURANO"]], 7683),
  fleetGroup(110, 60, "Mercedes-Benz C-Class", [["MERCEDES-BENZ", "C-CLASS"], ["MERCEDES-BENZ", "C"]], 7673),
  fleetGroup(111, 61, "Toyota Ractis", [["TOYOTA", "RACTIS"]], 7478),
  fleetGroup(112, 62, "Nissan Wingroad", [["NISSAN", "WINGROAD"]], 7394),
  fleetGroup(113, 63, "Toyota Caldina", [["TOYOTA", "CALDINA"]], 7365),
  fleetGroup(114, 64, "BMW 1 Series / 116i", [["BMW", "116I"], ["BMW", "1"], ["BMW", "1 SERIES"]], 7362),
  fleetGroup(115, 65, "Ford Mustang", [["FORD", "MUSTANG"]], 7256),
  fleetGroup(116, 66, "Mazda CX-9", [["MAZDA", "CX-9"]], 7160),
  fleetGroup(117, 67, "Hyundai iLoad", [["HYUNDAI", "ILOAD"]], 6960),
  fleetGroup(118, 68, "Holden Trax", [["HOLDEN", "TRAX"]], 6890),
  fleetGroup(119, 69, "Mitsubishi Mirage", [["MITSUBISHI", "MIRAGE"]], 6845),
  fleetGroup(120, 70, "Kia Cerato", [["KIA", "CERATO"]], 6802),
  fleetGroup(121, 71, "Land Rover Range Rover", [
    ["LAND ROVER", "RANGE ROVER"],
    ["LAND ROVER", "RANGE ROVER SPORT"],
    ["LAND ROVER", "RANGE ROVER EVOQUE"],
    ["LAND ROVER", "RANGE ROVER VELAR"],
  ], 6572),
  fleetGroup(122, 72, "Volkswagen Touareg", [["VOLKSWAGEN", "TOUAREG"]], 6551),
  fleetGroup(123, 73, "Fiat Ducato", [["FIAT", "DUCATO"]], 6540),
  fleetGroup(124, 74, "Volkswagen Passat", [["VOLKSWAGEN", "PASSAT"]], 6276),
  fleetGroup(125, 75, "Nissan Elgrand", [["NISSAN", "ELGRAND"]], 6269),
  fleetGroup(126, 76, "Kia Niro", [["KIA", "NIRO"]], 6071),
  fleetGroup(127, 77, "Mazda Verisa", [["MAZDA", "VERISA"]], 6027),
  fleetGroup(128, 78, "Nissan Pulsar", [["NISSAN", "PULSAR"]], 5856),
  fleetGroup(129, 79, "Mitsubishi L300", [["MITSUBISHI", "L300"]], 5851),
  fleetGroup(130, 80, "Mercedes-Benz Sprinter", [["MERCEDES-BENZ", "SPRINTER 3,5-T"], ["MERCEDES-BENZ", "SPRINTER"]], 5753),
  fleetGroup(131, 81, "GWM / Haval Jolion", [["GWM", "HAVAL JOLION"], ["GWM", "JOLION"], ["HAVAL", "JOLION"]], 5731),
  fleetGroup(132, 82, "Kia Carnival", [["KIA", "CARNIVAL"]], 5660)
];

export const POPULAR_CORE_75_VEHICLE_GROUPS = [
  ...REQUESTED_POPULAR_VEHICLE_GROUPS,
  ...POPULAR_75_ADDITIONAL_VEHICLE_GROUPS
];

export const POPULAR_EXTENDED_80_VEHICLE_GROUPS = [
  ...POPULAR_CORE_75_VEHICLE_GROUPS,
  ...POPULAR_80_ADDITIONAL_VEHICLE_GROUPS
];

// Default for all new coverage and gap work.
export const DEFAULT_POPULAR_VEHICLE_GROUPS = POPULAR_CORE_75_VEHICLE_GROUPS;

// Strategic models are maintained outside the fleet-percentage thresholds.
export const STRATEGIC_POPULAR_VEHICLE_GROUPS = [
  strategicGroup("BYD Shark 6", [["BYD", "SHARK 6"]])
];

export const OPERATIONAL_POPULAR_VEHICLE_GROUPS = [
  ...DEFAULT_POPULAR_VEHICLE_GROUPS,
  ...STRATEGIC_POPULAR_VEHICLE_GROUPS
];

// Backward-compatible name used by older operational wiper scripts.
export const EXPANDED_POPULAR_VEHICLE_GROUPS = OPERATIONAL_POPULAR_VEHICLE_GROUPS;

export const POPULAR_SCOPE_METADATA = Object.freeze({
  historical50: { groupCount: 50, years: [2000, 2026] },
  defaultCore75: { groupCount: 103, targetFleetSharePercent: 75.11, years: [2000, 2026] },
  extended80: { groupCount: 132, targetFleetSharePercent: 80.12, years: [2000, 2026] },
  strategicAdditional: { groupCount: 1 }
});

export function groupsForPopularScope(scope = "core75") {
  if (scope === "historical50") return REQUESTED_POPULAR_VEHICLE_GROUPS;
  if (scope === "core75") return POPULAR_CORE_75_VEHICLE_GROUPS;
  if (scope === "extended80") return POPULAR_EXTENDED_80_VEHICLE_GROUPS;
  if (scope === "operational") return OPERATIONAL_POPULAR_VEHICLE_GROUPS;
  throw new Error(`Unknown popular vehicle scope: ${scope}`);
}

export function buildPopularAliasIndex(groups) {
  const index = new Map();
  for (const item of groups) {
    for (const [make, model] of item.aliases) {
      const key = canonicalModelKey(make, model);
      const existing = index.get(key);
      if (existing && existing.id !== item.id) throw new Error(`Popular model alias ${key} belongs to both ${existing.id} and ${item.id}`);
      index.set(key, item);
    }
  }
  return index;
}

// Model aliases select the family; optional application filters keep broad
// catalog model names (for example MINI) from pulling unrelated body families
// into a fleet denominator. Product-fitment matching still happens at the
// application level after this scope gate.
export function popularGroupMatchesApplication(group, application = {}) {
  const allowedBodies = group?.applicationFilters?.bodyStyles ?? [];
  if (allowedBodies.length) {
    const body = normalizeBody(application.bodyStyle ?? application.body_style ?? application.variantName ?? application.variant_name ?? "");
    if (!allowedBodies.map(normalizeBody).includes(body)) return false;
  }
  return true;
}

function group(rank, label, aliases) {
  return { id: `requested-${String(rank).padStart(2, "0")}`, rank, label, source: "requested_2026-10-24", aliases };
}

function fleetGroup(rank, fleetPriority, label, aliases, fleetCount, applicationFilters = null) {
  return {
    id: `fleet-${String(rank).padStart(3, "0")}`,
    rank,
    fleetPriority,
    fleetCount,
    label,
    source: "nz_light_fleet_2000_2026_2026-10-25",
    aliases,
    ...(applicationFilters ? { applicationFilters } : {})
  };
}

function normalizeBody(value) {
  const body = String(value ?? "").trim().toUpperCase();
  if (body.includes("HATCH")) return "HATCHBACK";
  if (body.includes("CONVERT")) return "CONVERTIBLE";
  if (body.includes("COUPE")) return "COUPE";
  if (body.includes("WAGON") || body.includes("CLUBMAN")) return "WAGON";
  if (body.includes("SUV") || body.includes("COUNTRYMAN")) return "SUV";
  return body;
}

function strategicGroup(label, aliases) {
  return { id: `strategic-${slug(label)}`, rank: null, label, source: "strategic_operational_list", aliases };
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
