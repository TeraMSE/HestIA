import type {
  PersonaProfile, ApartmentConfig, CompatibilityResult, FrameSequence,
  PropertyPin, MaterialEstimate, TunisianClimate, Frame, AdminProcedureCard,
  ReportEntry,
} from "@/contracts/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- in-memory store ----------
const db = {
  personas: [] as PersonaProfile[],
  apartments: [] as ApartmentConfig[],
  reports: [] as ReportEntry[],
  pins: [] as PropertyPin[],
};

// ---------- Seed data ----------
const seedPersonas: PersonaProfile[] = [
  {
    id: "p_amira", name: "Amira", avatarColor: "#ffb3c1", traitCoverage: 92,
    bigFive: { openness: 78, conscientiousness: 70, extraversion: 60, agreeableness: 80, neuroticism: 35 },
    lifestyle: { noiseTolerance: 40, cleanliness: 85, thermalSensitivity: 70, smoker: false, schedule: "early_bird" },
    notes: "Loves quiet mornings and a tidy kitchen.",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "p_youssef", name: "Youssef", avatarColor: "#a0e7e5", traitCoverage: 88,
    bigFive: { openness: 65, conscientiousness: 50, extraversion: 80, agreeableness: 60, neuroticism: 45 },
    lifestyle: { noiseTolerance: 75, cleanliness: 55, thermalSensitivity: 40, smoker: false, schedule: "night_owl" },
    notes: "Loud music after 10pm, hosts friends.",
    updatedAt: new Date().toISOString(),
  },
];

const seedApartments: ApartmentConfig[] = [
  {
    id: "a_lacmar", label: "Lac Marina 2BR", address: "Les Berges du Lac, Tunis",
    lat: 36.8422, lng: 10.2719,
    rooms: { bedrooms: 2, bathrooms: 1, livingRooms: 1, kitchens: 1, balconies: 1 },
    building: { floor: 3, condition: "renovated", mass: "medium", orientation: "SE", elevator: true, heating: false, cooling: true, windows: "double" },
    utilities: { internet: true, water: true, electricity: true, gas: true },
    noiseScore: 62, neighborhoodScore: 78, thermalScore: 70,
    updatedAt: new Date().toISOString(),
  },
];

const seedPins: PropertyPin[] = [
  { id: "pin_1", kind: "property", lat: 36.8422, lng: 10.2719, title: "Lac Marina 2BR", subtitle: "Tunis · Renovated", scan: "scanned", apartmentId: "a_lacmar", priceTND: 1450, forRent: true },
  { id: "pin_2", kind: "property", lat: 36.8065, lng: 10.1815, title: "Médina Studio", subtitle: "Tunis Centre · Old", scan: "unscanned", priceTND: 750, forRent: true },
  { id: "pin_3", kind: "property", lat: 36.8525, lng: 10.3299, title: "Gammarth Sea View", subtitle: "Coastal · New", scan: "unscanned", priceTND: 320000, forSale: true },
  { id: "pin_4", kind: "property", lat: 35.8256, lng: 10.6360, title: "Sousse Family Home", subtitle: "Sahel · 4BR", scan: "scanned", priceTND: 245000, forSale: true },
  { id: "pin_5", kind: "property", lat: 34.7406, lng: 10.7603, title: "Sfax Loft", subtitle: "Coastal · Renovated", scan: "unscanned", priceTND: 980, forRent: true },
];

db.personas.push(...seedPersonas);
db.apartments.push(...seedApartments);
db.pins.push(...seedPins);

// ---------- Persona CRUD ----------
export const personaService = {
  async list() { await sleep(120); return [...db.personas]; },
  async save(p: Omit<PersonaProfile, "id" | "updatedAt"> & { id?: string }) {
    await sleep(150);
    const id = p.id ?? `p_${uid()}`;
    const next: PersonaProfile = { ...p, id, updatedAt: new Date().toISOString() };
    const idx = db.personas.findIndex((x) => x.id === id);
    if (idx >= 0) db.personas[idx] = next; else db.personas.push(next);
    return next;
  },
  async remove(id: string) { await sleep(100); db.personas = db.personas.filter((p) => p.id !== id); },
};

// ---------- Apartment CRUD ----------
export const apartmentService = {
  async list() { await sleep(120); return [...db.apartments]; },
  async save(a: Omit<ApartmentConfig, "id" | "updatedAt"> & { id?: string }) {
    await sleep(150);
    const id = a.id ?? `a_${uid()}`;
    const next: ApartmentConfig = { ...a, id, updatedAt: new Date().toISOString() };
    const idx = db.apartments.findIndex((x) => x.id === id);
    if (idx >= 0) db.apartments[idx] = next; else db.apartments.push(next);
    return next;
  },
  async remove(id: string) { await sleep(100); db.apartments = db.apartments.filter((a) => a.id !== id); },
  async runChecks(id: string) {
    await sleep(400);
    const a = db.apartments.find((x) => x.id === id);
    if (!a) throw new Error("not found");
    a.noiseScore = 40 + Math.round(Math.random() * 50);
    a.neighborhoodScore = 50 + Math.round(Math.random() * 45);
    a.thermalScore = 50 + Math.round(Math.random() * 45);
    return a;
  },
};

// ---------- Pins ----------
export const pinService = {
  async list() { await sleep(80); return [...db.pins]; },
  async add(pin: Omit<PropertyPin, "id">) {
    await sleep(120);
    const next = { ...pin, id: `pin_${uid()}` };
    db.pins.push(next);
    return next;
  },
  async remove(id: string) { await sleep(80); db.pins = db.pins.filter((p) => p.id !== id); },
};

// ---------- Simulation ----------
function gradeFromScore(s: number) {
  if (s >= 85) return "A" as const;
  if (s >= 70) return "B" as const;
  if (s >= 55) return "C" as const;
  if (s >= 40) return "D" as const;
  return "F" as const;
}

export const simulationService = {
  async run(opts: { personaAId: string; personaBId: string; apartmentId: string; ticks: number; onProgress?: (p: number) => void }) {
    const a = db.personas.find((p) => p.id === opts.personaAId);
    const b = db.personas.find((p) => p.id === opts.personaBId);
    const apt = db.apartments.find((x) => x.id === opts.apartmentId);
    if (!a || !b || !apt) throw new Error("missing inputs");

    for (let i = 1; i <= 10; i++) { await sleep(120); opts.onProgress?.(i * 10); }

    const noise = Math.max(0, 100 - Math.abs(a.lifestyle.noiseTolerance - b.lifestyle.noiseTolerance));
    const cleanliness = Math.max(0, 100 - Math.abs(a.lifestyle.cleanliness - b.lifestyle.cleanliness));
    const thermal = Math.max(0, 100 - Math.abs(a.lifestyle.thermalSensitivity - b.lifestyle.thermalSensitivity));
    const schedule = a.lifestyle.schedule === b.lifestyle.schedule ? 95 : a.lifestyle.schedule === "flexible" || b.lifestyle.schedule === "flexible" ? 70 : 35;
    const social = Math.max(0, 100 - Math.abs(a.bigFive.extraversion - b.bigFive.extraversion) / 2 - Math.abs(a.bigFive.agreeableness - b.bigFive.agreeableness) / 2);

    const overall = Math.round((noise + cleanliness + thermal + schedule + social) / 5);

    const conflicts = [
      noise < 60 && { tick: Math.floor(opts.ticks * 0.2), category: "noise" as const, description: `${b.name} plays music while ${a.name} reads.`, severity: noise < 35 ? "high" as const : "medium" as const },
      cleanliness < 60 && { tick: Math.floor(opts.ticks * 0.4), category: "cleanliness" as const, description: `Dishes left overnight in the kitchen.`, severity: "low" as const },
      thermal < 60 && { tick: Math.floor(opts.ticks * 0.55), category: "thermal" as const, description: `Disagreement on AC temperature.`, severity: "medium" as const },
      schedule < 60 && { tick: Math.floor(opts.ticks * 0.7), category: "schedule" as const, description: `${a.name} woken up at 1am.`, severity: "high" as const },
    ].filter(Boolean) as CompatibilityResult["conflicts"];

    const positives = [
      { tick: Math.floor(opts.ticks * 0.15), description: "Shared coffee in the morning ☕" },
      { tick: Math.floor(opts.ticks * 0.5), description: "Cooked dinner together 🍝" },
      { tick: Math.floor(opts.ticks * 0.85), description: "Watched a movie together 🎬" },
    ];

    const result: CompatibilityResult = {
      id: `r_${uid()}`,
      personaAId: a.id, personaBId: b.id, apartmentId: apt.id,
      ticks: opts.ticks,
      compatibilityPct: overall,
      conflicts, positives,
      grade: gradeFromScore(overall),
      overallScore: overall,
      breakdown: { noise, cleanliness, thermal, schedule, social },
      createdAt: new Date().toISOString(),
    };

    db.reports.unshift({
      id: result.id, createdAt: result.createdAt,
      personaA: a.name, personaB: b.name, apartmentLabel: apt.label,
      grade: result.grade, score: result.overallScore,
    });

    return result;
  },

  async getReport(id: string): Promise<ReportEntry | undefined> {
    await sleep(80); return db.reports.find((r) => r.id === id);
  },
  async listReports() { await sleep(80); return [...db.reports]; },
};

// ---------- Frame sequence ----------
export const replayService = {
  async generate(result: CompatibilityResult): Promise<FrameSequence> {
    await sleep(250);
    const a = db.personas.find((p) => p.id === result.personaAId)!;
    const b = db.personas.find((p) => p.id === result.personaBId)!;
    const apt = db.apartments.find((x) => x.id === result.apartmentId)!;

    const frames: Frame[] = [];
    const totalFrames = Math.min(48, Math.max(12, Math.floor(result.ticks / 2)));
    for (let i = 0; i < totalFrames; i++) {
      const t = i / (totalFrames - 1);
      const time = `${String(Math.floor(8 + t * 14)).padStart(2, "0")}:${String(Math.floor((t * 60) % 60)).padStart(2, "0")}`;
      const conflict = result.conflicts.find((c) => Math.abs(c.tick / result.ticks - t) < 0.05);
      const positive = result.positives.find((p) => Math.abs(p.tick / result.ticks - t) < 0.05);
      frames.push({
        tick: i,
        timeLabel: time,
        personas: [
          { personaId: a.id, x: 0.2 + Math.sin(t * 6) * 0.15, y: 0.3 + Math.cos(t * 4) * 0.2, mood: conflict ? "annoyed" : "happy", speech: positive?.description },
          { personaId: b.id, x: 0.7 + Math.cos(t * 5) * 0.15, y: 0.6 + Math.sin(t * 3) * 0.2, mood: conflict ? "angry" : "neutral", speech: conflict?.description },
        ],
        events: [
          ...(conflict ? [{ type: "conflict" as const, description: conflict.description }] : []),
          ...(positive ? [{ type: "positive" as const, description: positive.description }] : []),
        ],
      });
    }

    return { apartment: apt, personas: [a, b], frames, simulation_summary: result };
  },
};

// ---------- Material Agent ----------
function climateForRegion(region: string): TunisianClimate {
  const r = region.toLowerCase();
  if (/(tunis|bizerte|nabeul|hammamet|gammarth|carthage)/.test(r)) return "coastal";
  if (/(sousse|monastir|mahdia|sfax)/.test(r)) return "sahelian";
  if (/(beja|jendouba|kef|siliana)/.test(r)) return "northern";
  return "inland";
}

const materialCatalog = (areaM2: number, climate: TunisianClimate, rooms: number) => {
  const base = (qty: number, unit: string, p: number, name: string, category: any, brand?: string) =>
    ({ id: uid(), name, category, brand, unit, unitPriceTND: p, quantity: Math.round(qty * 100) / 100, totalTND: Math.round(qty * p * 100) / 100 });
  const items = [
    // Structural (10)
    base(areaM2 * 0.35, "tonne", 980, "Cement CPA 45", "structural", "SOTACIB"),
    base(areaM2 * 0.06, "tonne", 2450, "Steel rebar Ø8-Ø12", "structural", "El Fouladh"),
    base(areaM2 * 0.7, "m³", 220, "Sand 0/4", "structural"),
    base(areaM2 * 0.9, "m³", 280, "Gravel 8/15", "structural"),
    base(areaM2 * 12, "unit", 1.6, "Hollow brick 8 holes", "structural"),
    base(areaM2 * 8, "unit", 2.1, "Hollow brick 12 holes", "structural"),
    base(areaM2 * 0.08, "m³", 580, "Ready-mix concrete C25", "structural"),
    base(rooms * 4, "unit", 95, "Lintel beam 1.2m", "structural"),
    base(areaM2 * 0.15, "m²", 35, "Hourdis ceiling block", "structural"),
    base(areaM2 * 0.02, "tonne", 980, "Mortar mix", "structural", "SOTACIB"),
    // Waterproofing (8)
    base(areaM2 * 0.4, "L", 22, "Sika-1 liquid", "waterproofing", "SIKA"),
    base(areaM2 * 0.25, "kg", 18, "Sikatop 121", "waterproofing", "SIKA"),
    base(areaM2 * 0.3, "m²", 28, "Mapelastic membrane", "waterproofing", "MAPEI"),
    base(areaM2 * 0.4, "m²", 24, "Soprema bitumen sheet", "waterproofing", "SOPREMA"),
    base(rooms * 2, "L", 32, "Anti-mold primer", "waterproofing"),
    base(areaM2 * 0.1, "kg", 45, "Crack-bridging coat", "waterproofing", "MAPEI"),
    base(rooms, "L", 28, "Bathroom sealant kit", "waterproofing", "SIKA"),
    base(areaM2 * 0.05, "m", 12, "Drainage profile", "waterproofing"),
    // Insulation (6)
    base(areaM2 * 0.6, "m²", 32, "Polystyrene EPS 40mm", "insulation"),
    base(areaM2 * 0.3, "m²", 48, "Rockwool panel", "insulation"),
    base(areaM2 * 0.4, "m²", 22, "Reflective foil", "insulation"),
    base(areaM2 * 0.05, "m", 6, "Sealing foam tape", "insulation"),
    base(rooms * 3, "kg", 14, "Acoustic mastic", "insulation"),
    base(areaM2 * 0.1, "L", 38, "Polyurethane foam can", "insulation"),
    // Coatings (8)
    base(areaM2 * 1.2, "m²", 42, "Wall tile 30x60", "coatings", "SOMOCER"),
    base(areaM2 * 0.9, "m²", 58, "Floor porcelain 60x60", "coatings", "SOMOCER"),
    base(areaM2 * 0.05, "kg", 12, "Tile adhesive", "coatings", "MAPEI"),
    base(areaM2 * 0.04, "kg", 9, "Joint grout", "coatings", "MAPEI"),
    base(areaM2 * 0.4, "L", 18, "Acrylic paint white", "coatings"),
    base(areaM2 * 0.2, "L", 24, "Color paint accent", "coatings"),
    base(areaM2 * 0.6, "kg", 8, "Plaster skim coat", "coatings"),
    base(areaM2 * 0.15, "L", 14, "Primer", "coatings"),
    // Carpentry (8)
    base(rooms, "unit", 480, "Interior wood door", "carpentry"),
    base(1, "unit", 950, "Reinforced entrance door", "carpentry"),
    base(rooms * 1.5, "m²", 280, "Aluminum window frame", "carpentry"),
    base(rooms * 1.5, "m²", 220, "Double glazing", "carpentry"),
    base(rooms, "unit", 320, "Window shutter", "carpentry"),
    base(rooms * 4, "m", 28, "Skirting board", "carpentry"),
    base(rooms, "unit", 850, "Built-in wardrobe", "carpentry"),
    base(1, "unit", 2200, "Kitchen cabinetry", "carpentry"),
    // Plumbing (8)
    base(areaM2 * 0.3, "m", 14, "PVC pipe Ø32", "plumbing"),
    base(areaM2 * 0.2, "m", 22, "PER pipe Ø16", "plumbing"),
    base(rooms * 2, "unit", 95, "Mixer faucet", "plumbing"),
    base(1, "unit", 380, "WC ceramic kit", "plumbing"),
    base(1, "unit", 520, "Shower tray + drain", "plumbing"),
    base(1, "unit", 480, "Bathroom vanity", "plumbing"),
    base(1, "unit", 1200, "Water heater 100L", "plumbing"),
    base(rooms * 4, "unit", 18, "Pipe fittings pack", "plumbing"),
    // Electrical (8)
    base(areaM2 * 1.4, "m", 4.5, "Electrical cable 2.5mm", "electrical", "COFICAB"),
    base(areaM2 * 0.6, "m", 6.2, "Cable 4mm", "electrical", "COFICAB"),
    base(rooms * 6, "unit", 22, "Wall socket", "electrical", "LEGRAND"),
    base(rooms * 4, "unit", 18, "Light switch", "electrical", "LEGRAND"),
    base(1, "unit", 320, "Distribution box", "electrical", "LEGRAND"),
    base(rooms * 2, "unit", 65, "LED ceiling light", "electrical"),
    base(rooms, "unit", 28, "Junction box", "electrical"),
    base(areaM2 * 0.4, "m", 3.2, "PVC conduit", "electrical"),
    // Finishing (6)
    base(areaM2 * 0.05, "kg", 22, "Silicone sealant", "finishing"),
    base(rooms, "unit", 180, "Door handle set", "finishing"),
    base(areaM2 * 0.3, "m²", 65, "Decorative molding", "finishing"),
    base(rooms, "unit", 240, "Mirror", "finishing"),
    base(1, "unit", 1800, "Stair railing", "finishing"),
    base(rooms, "unit", 95, "Curtain rail kit", "finishing"),
  ];
  // Climate adjustments
  if (climate === "coastal") items.forEach((i) => { if (i.category === "waterproofing") { i.quantity *= 1.3; i.totalTND = Math.round(i.quantity * i.unitPriceTND * 100) / 100; } });
  if (climate === "inland") items.forEach((i) => { if (i.category === "insulation") { i.quantity *= 1.25; i.totalTND = Math.round(i.quantity * i.unitPriceTND * 100) / 100; } });
  return items;
};

export const materialService = {
  async analyzePlan(_file?: File) {
    await sleep(800);
    return { areaM2: 95 + Math.round(Math.random() * 60), rooms: 3 + Math.floor(Math.random() * 3), dimensions: "8.5m × 11.2m" };
  },
  async estimate(opts: { region: string; budgetTND: number; areaM2: number; rooms: number }): Promise<MaterialEstimate> {
    await sleep(500);
    const climate = climateForRegion(opts.region);
    const items = materialCatalog(opts.areaM2, climate, opts.rooms);
    const total = Math.round(items.reduce((s, i) => s + i.totalTND, 0));
    const ratio = opts.budgetTND / total;
    let verdict: MaterialEstimate["verdict"] = "optimal";
    let verdictExplanation = "Your budget aligns with estimated costs for the selected climate.";
    let upgrades: string[] | undefined;
    let reductionSuggestion: string | undefined;
    if (ratio < 0.85) {
      verdict = "insufficient";
      const suggestedArea = Math.floor(opts.areaM2 * ratio * 0.95);
      verdictExplanation = `Budget covers ~${Math.round(ratio * 100)}% of the estimate.`;
      reductionSuggestion = `Consider reducing surface to about ${suggestedArea} m² or lowering finish tier.`;
    } else if (ratio > 1.2) {
      verdict = "excess";
      verdictExplanation = "You have surplus — invest in heritage finishes.";
      upgrades = [
        "Zellige tilework from Nabeul for entryway",
        "Maktar marble countertop in kitchen",
        "Hand-forged Sfax ironwork balcony",
        "Solid olive-wood interior doors",
      ];
    }

    const waterproofingPlan = {
      antiMold: climate === "coastal"
        ? ["Apply anti-mold primer twice in bathrooms", "Ventilate kitchen with extractor"]
        : ["Anti-mold primer once in wet rooms"],
      antiCracking: ["Mapelastic on slabs", "Crack-bridging coat at junctions"],
      antiInfiltration: climate === "coastal"
        ? ["Soprema bitumen on roof + parapets", "Sika-1 mixed with mortar at foundations"]
        : ["Sika-1 mixed with mortar at foundations"],
    };

    return {
      id: `m_${uid()}`, region: opts.region, climate,
      budgetTND: opts.budgetTND, estimatedAreaM2: opts.areaM2, rooms: opts.rooms,
      items, totalTND: total, verdict, verdictExplanation,
      waterproofingPlan, upgrades, reductionSuggestion,
      createdAt: new Date().toISOString(),
    };
  },
  toCSV(estimate: MaterialEstimate): string {
    const header = "Category,Name,Brand,Unit,Quantity,Unit Price (TND),Total (TND)";
    const rows = estimate.items.map((i) => [i.category, `"${i.name}"`, i.brand ?? "", i.unit, i.quantity, i.unitPriceTND, i.totalTND].join(","));
    return [header, ...rows, `,,,,,,${estimate.totalTND}`].join("\n");
  },
};

// ---------- Admin Assistant ----------
const procedureCards: Record<string, AdminProcedureCard> = {
  rent: {
    title: "Renting an apartment in Tunisia",
    steps: ["Visit and verify the property", "Negotiate rent and duration", "Sign a written lease (contrat de bail)", "Register lease at the recette des finances", "Pay first month + security deposit (1–3 months)"],
    documents: ["CIN (national ID)", "Proof of income / employment", "Two guarantors (often required)", "Receipt of deposit"],
    timeline: "Typically 1–2 weeks from visit to keys.",
    risks: ["Unregistered lease has no legal protection", "Verbal agreements are not enforceable for >1 year"],
  },
  buy: {
    title: "Buying property in Tunisia",
    steps: ["Get an attestation de propriété from the seller", "Sign a compromis de vente", "Pay 10% deposit", "Notary drafts the final deed", "Pay registration tax (5%) and notary fees", "Register at Conservation Foncière"],
    documents: ["CIN or passport", "Title deed (titre foncier or bleu)", "Tax clearance certificate", "Cadastral plan"],
    timeline: "2–4 months for titled properties; longer for untitled (arabe).",
    risks: ["Untitled land has unclear ownership", "Foreigners need governorate authorization outside tourist zones"],
  },
  list: {
    title: "Listing your property",
    steps: ["Get tax clearance", "Set price with comparable analysis", "Take photos / scan in 3D", "Publish to HestIA", "Screen tenants/buyers"],
    documents: ["Title deed", "Latest TCL receipt", "Co-ownership rules if applicable"],
    timeline: "Listing live within 24h.",
    risks: ["Misrepresenting condition leads to disputes", "Illegal subletting voids insurance"],
  },
};

export const adminService = {
  async ask(query: string): Promise<{ content: string; cards?: AdminProcedureCard[] }> {
    await sleep(450);
    const q = query.toLowerCase();
    if (/(rent|loue|louer|kiraya)/.test(q)) return { content: "Here is the standard renting procedure in Tunisia.", cards: [procedureCards.rent] };
    if (/(buy|achat|acheter|purchase)/.test(q)) return { content: "Here is what buying property in Tunisia involves.", cards: [procedureCards.buy] };
    if (/(list|publish|sell|vendre)/.test(q)) return { content: "Here is how to list your property on HestIA.", cards: [procedureCards.list] };
    return { content: "I can help with renting, buying, or listing. Try asking: 'How do I rent in Tunis?'" };
  },
};
