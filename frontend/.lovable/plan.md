
# HestIA — Map-Centric Real Estate Platform (Frontend v1)

A full-screen, Sims-inspired map experience where every feature is a layer or pin-triggered overlay. Mock-data first, desktop-first, fully responsive, ready for backend wiring later.

## Tech & Foundations
- **Map:** Leaflet + OpenStreetMap, full-viewport (100vw × 100vh) under all UI.
- **Style:** "Cozy Pastel Sims" — soft pinks `#fff5f7 / #ffd6e0`, mint `#a0e7e5`, ink `#5b6c8a`. Rounded-2xl panels, soft shadows, playful but readable.
- **Data layer:** typed view models + a `services/` adapter (mock-first) so backend can be swapped in later with no UI changes.
- **State:** central store (Zustand) for selected pin, selected personas, apartment, run status, current frame, playback.
- **i18n-ready strings**, FR/EN/AR friendly structure (no translation done in v1).

## 1. Onboarding (pre-map, Sims-inspired one-question-per-page)
Empty page, single question centered, large playful input, Plumbob-style progress bead.
- Step 1: "Who are you?" → **Renter / Buyer** vs **Landlord** (path branches but visual is identical).
- Steps 2–8: Personality questions first (Big Five lite + lifestyle: noise, cleanliness, thermal, smoker, schedule).
- Step 9: Email + create account (mock).
- Step 10: Drop into the map with a welcome pulse on user's location.

## 2. The Map (home base after login)
- Full-screen Leaflet map with custom pastel tile styling.
- **Pins:** existing properties (scanned/unscanned badges), user-saved pins, simulation results.
- **Add pin:** click empty map → "Add a place here" mini-popover.
- **Click pin:** opens a right-side **Property Drawer** (not a new page) with tabs: Overview · 3D Tour · Compatibility · Materials · Admin Help.
- **Floating overlay icons** (always on top of map):
  - Top-left: HestIA logo + profile avatar.
  - Top-right: search address, filter pins, layer toggles (properties / my pins / climate zones).
  - Bottom-right stack: **Persona Builder**, **Apartment Configurator**, **Material Agent**, **Admin Assistant**, **Reports/History**, **Module Dashboard** — each opens as an overlay panel, never leaving the map.

## 3. HestIA Psychological Module (overlay panels)
Triggered from the bottom-right toolbar OR from a pin's "Compatibility" tab.

- **Module Dashboard:** quick actions, recent simulations, saved personas/apartments counters, mock backend health badges.
- **Persona Builder:** Persona A/B tabs, interview chat (assistant bubble + composer + send + progress meter + trait coverage), manual editor (Big Five sliders + lifestyle toggles), profile cards, save/update/delete library.
- **Apartment Configurator:** auto-prefilled from selected pin; room topology (bed/bath/living/kitchen/balcony), building metadata (floor, condition, mass, orientation, elevator, HVAC, windows), utilities, neighborhood/noise/thermal panels, presets.
- **Simulation Runner:** select Persona A, Persona B, apartment preset; ticks/hours; Run with streamed progress; results cards (compatibility %, conflicts, positive interactions, grade, score); expandable conflict log, mediation checklist, score breakdown, raw payload.
- **Visual Replay:** **2D mode only in v1** + a clearly-labelled "3D coming soon" placeholder toggle. Scenario header, viewport, timeline scrubber, play/pause/step/restart, speed (0.5×/1×/2×/4×), event drawer, speech bubbles, conflict highlights, end-of-run summary modal. Pause-on-scrub, auto-stop at final frame, playback state preserved across mode toggle.
- **Reports/History:** list + detail of past runs, filters, export JSON / PDF placeholder.

## 4. Material Agent (overlay)
- Region selector (auto-detect coastal / Sahelian / northern / inland Tunisian climate).
- Budget input (TND).
- Upload 2D plan → mock vision analysis returns area / rooms / dimensions (placeholder result).
- Generated **60+ materials table A→Z** with quantity, 2026 TND unit price, total — grouped by structural / waterproofing / insulation / coatings / carpentry / plumbing / electrical / finishing, with brand tags (SOTACIB, El Fouladh, SIKA, MAPEI, SOPREMA, SOMOCER, COFICAB, LEGRAND).
- Budget verdict card: **Optimal / Insufficient (suggest reduced surface) / Excess (Zellige Nabeul, Maktar marble, Sfax ironwork upgrade plan)**.
- Climate-justified waterproofing plan (anti-mold / anti-cracking / anti-infiltration).
- **CSV export**.

## 5. Admin / Procedures Assistant (floating overlay icon on the map)
- Persistent chat-bubble icon, bottom-left of map.
- Opens a chat overlay guiding through Tunisian real estate procedures: steps, required documents, timelines, risks.
- Mock conversational flow with structured cards + checklist UI.

## 6. Property Drawer — 3D Tour tab
- Placeholder viewport panel (Sims-styled empty stage with "Scan with phone" and "View existing scan" CTAs, both mocked).
- Hooks/contract types ready so the real renderer drops in later with zero refactor.

## 7. Landlord vs Renter views
- Same map shell. Role flag changes:
  - **Landlord:** "My Properties" layer, "Add property + scan" CTA on pins they own, listing/edit overlay.
  - **Renter/Buyer:** "Saved", "Compatibility-ranked" layer, request-visit CTA in drawer.

## 8. Data Contracts (typed, mock-backed)
`PersonaProfile`, `ApartmentConfig`, `CompatibilityResult`, `MediationResult`, `ScoreBreakdown`, `FrameSequence { apartment, personas, frames, simulation_summary }`, `MaterialEstimate`, `PropertyPin`, `User { role }`.

Service adapter methods (all mock): persona CRUD, apartment CRUD, runSimulation, getReport, getFrameSequence, generateFrameSequence, noise/neighborhood/thermal checks, materialEstimate, adminAssistantQuery, mapPins CRUD.

## 9. UX & Quality
Loading / empty / error / retry states everywhere · toasts · inline form errors · disabled states · optimistic updates where safe · keyboard nav · focus rings · ARIA labels · WCAG-AA contrast on the pastel palette · mock network timeout handling.

## 10. Code Organization
```
src/
  features/
    map/  onboarding/  persona/  apartment/  simulation/
    replay/  reports/  material-agent/  admin-assistant/
    property-drawer/
  shared/ui/   shared/hooks/   shared/store/
  services/ (mock adapters)
  contracts/ (types)
```

## Out of scope for v1 (explicit)
- Real 3D renderer (placeholder only, per your instruction).
- Real auth / DB (mock only).
- Real LLM calls (Material Agent + Admin Assistant return mock structured responses; ready to wire to Gemini 3.1 Pro later).
- Real PDF export (button + toast placeholder; CSV is real for materials).
