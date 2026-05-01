# 🏠 HestIA — Intelligent Apartment Finder & Life Simulation Platform

> **1st place — CYBERIA 2026 Hackathon** · Advanced AI Project · ESPRIT Grade 4

HestIA is a full-stack AI-powered apartment intelligence platform that combines real-time environmental assessment, LLM-driven roommate compatibility simulation, and 3D room visualization — all in an interactive map-based interface.

---

## ✨ Features

### 🗺️ Interactive Map
- Live property pins with price, rating, and interest indicators
- Real-time OpenStreetMap POI overlays (restaurants, hospitals, transit, etc.) via Overpass API
- Property interest toggle with social awareness (see who else is interested)

### 📊 Neighborhood Intelligence (HestIA-LS)
- **Noise Assessment** — scores location quietness using OSM road/amenity density
- **Walkability / Neighborhood Profile** — 25 POI categories, transport grid, emergency access
- **Thermal Comfort** — 12-month indoor temperature projection based on building orientation & mass
- **Travel Time Estimation** — real routing via OpenRouteService with haversine fallback

### 🏗️ 3D Room Simulation
- Upload a panoramic photo → HorizonNet extracts room layout
- YOLO-World zero-shot furniture detection
- Three.js 3D room viewer with agent simulation

### 🤝 Life Simulation (HestIA-LS Engine)
- LLM-orchestrated roommate compatibility engine (Ollama / OpenAI)
- SOTOPIA-inspired social agent simulation with mediation
- Compatibility grade (A–F), lease checklist, and full narrated report
- Persona system synced to user profile

### 👥 Social Layer
- Friend system with persona sharing
- Property interest tracking
- Roommate matching via compatibility simulation

---

## 🏗️ Architecture

```
HestIA/
├── backend/                  # Django 5.2 REST API
│   ├── hestia/               # Project settings & routing
│   ├── users/                # Custom user model, persona, friends, social
│   ├── properties/           # Property listings & interest
│   ├── room_sim/             # 3D pipeline (HorizonNet + YOLO-World)
│   └── social_sim/           # HestIA-LS engine
│       ├── engine/           # Persona, Environment, LLM, Compatibility, Mediation, Scoring
│       ├── noise_assessment/ # OSM noise scoring with diskcache
│       ├── neighborhood/     # POI fetcher, travel time (ORS), neighborhood profiler
│       └── thermal/          # Climate model & comfort projections
│
└── frontend/                 # React 18 + Vite + TypeScript
    ├── src/
    │   ├── features/
    │   │   ├── apartment/    # ApartmentConfigurator with real assessments
    │   │   ├── neighborhood/ # NeighborhoodIntel overlay
    │   │   ├── property-drawer/ # Property detail with Intel tab
    │   │   ├── simulation/   # SimulationRunner (LLM compatibility)
    │   │   └── persona/      # Persona builder & sync
    │   ├── services/
    │   │   ├── api.ts        # Axios base client (JWT auto-refresh)
    │   │   ├── assessmentApi.ts  # HestIA-LS endpoints
    │   │   └── socialApi.ts  # Social & persona endpoints
    │   └── shared/
    │       └── store/        # Zustand state (auth, app, overlays)
    └── public/
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- Ollama (for local LLM simulation) — install from https://ollama.com then run `ollama pull llama3.2:3b`

### 1 — Clone

```bash
git clone https://github.com/TeraMSE/HestIA.git
cd HestIA
```

### 2 — Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Linux / macOS

# Install dependencies
pip install -r requirements.txt

# Configure environment
copy .env.example .env        # Windows
# cp .env.example .env        # Linux / macOS
# → Open .env and set SECRET_KEY at minimum. Everything else works with defaults.

# Run database migrations
python manage.py migrate

# Start the server
python manage.py runserver    # → http://localhost:8000
```

### 3 — Frontend

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
copy .env.example .env.local  # Windows
# cp .env.example .env.local  # Linux / macOS
# → The default VITE_API_URL=http://localhost:8000 works for local dev.

# Start the dev server
npm run dev                   # → http://localhost:5173 (or next available port)
```

---

## ⚙️ Environment Variables

Create `backend/.env`:

```env
# Django
SECRET_KEY=your-secret-key

# LLM Backend (choose one)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b

# OpenRouteService (optional — for real travel times)
ORS_API_KEY=your-ors-key

# Overpass API (optional — custom mirror)
OVERPASS_URL=https://overpass-api.de/api/interpreter
OVERPASS_USER_AGENT=HestIA/1.0 (your-email@example.com)

# Cache directories (optional)
NOISE_CACHE_DIR=./noise_cache
NEIGHBORHOOD_CACHE_DIR=./neighborhood_cache
```

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
```

---

## 🔑 API Endpoints

### Authentication (Djoser + SimpleJWT)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/users/` | Register |
| POST | `/api/v1/auth/jwt/create/` | Login → access + refresh tokens |
| POST | `/api/v1/auth/jwt/refresh/` | Refresh access token |
| GET | `/api/v1/auth/users/me/` | Current user profile |

### HestIA-LS Assessment
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/social-sim/noise/assess/` | Noise level assessment |
| POST | `/api/v1/social-sim/neighborhood/profile/` | Full neighborhood profile |
| POST | `/api/v1/social-sim/thermal/assess/` | Thermal comfort projection |
| POST | `/api/v1/social-sim/compatibility/simulate/` | LLM roommate simulation |
| GET | `/api/v1/social-sim/compatibility/report/{id}/` | Retrieve simulation report |

### Social
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/v1/users/me/friends/` | Friend list / send request |
| GET/PUT | `/api/v1/users/me/persona/` | My persona |
| GET/POST | `/api/v1/properties/{id}/interest/` | Toggle interest |

---

## 🧠 HestIA-LS Engine

The life simulation engine is a port of the standalone HestIA-LS research project into the Django backend. It implements:

- **Persona** — trait vectors (cleanliness, noise tolerance, sleep schedule, etc.)
- **Environment** — shared apartment spatial model
- **LLM Client** — unified Ollama/OpenAI interface with fallback
- **Compatibility Agent** — runs N ticks of cohabitation simulation
- **Mediation Agent** — generates house rules and conflict resolution
- **SOTOPIA Scorer** — grades compatibility A–F with detailed metrics

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Django 5.2, Django REST Framework, Djoser, SimpleJWT |
| Database | SQLite (dev) / PostgreSQL (prod) |
| LLM | Ollama (llama3.2:3b default) / OpenAI-compatible |
| 3D Pipeline | HorizonNet, YOLO-World, Three.js |
| POI Data | OpenStreetMap / Overpass API |
| Routing | OpenRouteService |
| Frontend | React 18, TypeScript, Vite, Zustand, TanStack Query |
| UI | shadcn/ui, Tailwind CSS, Lucide Icons |
| Maps | Leaflet, React-Leaflet |

---

## 📄 License

Academic project — ESPRIT Engineering School, 2025–2026.
