# # web_search_agent.py — Domus AI · Web Search Agent
# # LangChain + DuckDuckGo + Llama 4 via Groq
# import json
# import re
# from langchain_groq import ChatGroq
# from langchain_community.tools import DuckDuckGoSearchRun
# from langchain.agents import AgentExecutor, create_react_agent
# from langchain.prompts import PromptTemplate
# from langchain.tools import Tool

# GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

# search_tool = DuckDuckGoSearchRun()

# tools = [
#     Tool(
#         name="web_search",
#         func=search_tool.run,
#         description="Recherche web pour trouver les specs techniques d'un appareil électroménager (kWh/an, année de fabrication, classe énergétique)"
#     )
# ]

# llm = ChatGroq(
#     api_key=GROQ_API_KEY,
#     model="meta-llama/llama-4-scout-17b-16e-instruct",
#     temperature=0.1,
#     max_tokens=500,
# )

# PROMPT_TEMPLATE = """Tu es un expert en appareils électroménagers. Ton rôle est de trouver la consommation kWh/an et l'année de fabrication d'un appareil.

# Tu as accès à l'outil: web_search

# Outils disponibles:
# {tools}

# Noms des outils: {tool_names}

# Instructions:
# 1. Recherche "{brand} {serial} specifications kWh consumption" 
# 2. Si pas de résultat précis, cherche "{brand} {appliance_type} average kWh per year"
# 3. Extrais: kWh/an, année de fabrication, classe énergétique
# 4. Réponds en JSON pur

# Format de réponse FINAL (obligatoire, JSON pur sans markdown):
# {{
#   "label": "nom complet de l'appareil",
#   "kwh_per_year": <nombre entier>,
#   "annee_fabrication": <année ou null>,
#   "classe_energie": "<A+++/A++/A+/A/B/C/D/E/F ou null>",
#   "source": "fiche technique officielle / estimation gamme",
#   "confiance": "haute / moyenne / faible"
# }}

# Question: {input}

# {agent_scratchpad}"""

# prompt = PromptTemplate(
#     template=PROMPT_TEMPLATE,
#     input_variables=["input", "agent_scratchpad", "tools", "tool_names", "brand", "serial", "appliance_type"]
# )

# def search_appliance_specs(brand: str, serial: str = "", appliance_type: str = "") -> dict:
#     """
#     Recherche les specs d'un appareil via DuckDuckGo + Llama 4.
#     brand est obligatoire, serial et appliance_type sont optionnels.
#     """
#     if not brand:
#         raise ValueError("La marque est obligatoire")

#     query_parts = [brand]
#     if serial:
#         query_parts.append(serial)
#     if appliance_type:
#         query_parts.append(appliance_type)
#     query_parts.append("kWh consumption specifications energy class")
#     query = " ".join(query_parts)

#     try:
#         agent = create_react_agent(llm, tools, prompt)
#         executor = AgentExecutor(
#             agent=agent,
#             tools=tools,
#             verbose=False,
#             max_iterations=3,
#             handle_parsing_errors=True,
#         )
#         result = executor.invoke({
#             "input": query,
#             "brand": brand,
#             "serial": serial or "non renseigné",
#             "appliance_type": appliance_type or "électroménager",
#         })
        
#         output = result.get("output", "")
#         # Nettoyer le JSON
#         output = re.sub(r'```json|```', '', output).strip()
#         # Extraire le premier JSON valide
#         match = re.search(r'\{.*\}', output, re.DOTALL)
#         if match:
#             data = json.loads(match.group())
#         else:
#             data = json.loads(output)
            
#         # Calculer l'âge
#         import datetime
#         current_year = datetime.datetime.now().year
#         annee = data.get("annee_fabrication")
#         data["age_ans"] = max(0, current_year - annee) if annee else None
        
#         return {"success": True, "data": data}
        
#     except Exception as e:
#         return {
#             "success": False,
#             "error": str(e),
#             "data": {
#                 "label": f"{brand} {appliance_type}".strip(),
#                 "kwh_per_year": None,
#                 "annee_fabrication": None,
#                 "age_ans": None,
#                 "classe_energie": None,
#                 "source": "Recherche échouée",
#                 "confiance": "faible"
#             }
#         }
















# import json
# import re
# from groq import Groq
# from ddgs import DDGS
# from datetime import datetime

# GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

# client = Groq(api_key=GROQ_API_KEY)


# # ─────────────────────────────
# # WEB SEARCH
# # ─────────────────────────────
# def web_search(query, max_results=5):
#     try:
#         with DDGS() as ddgs:
#             results = ddgs.text(query, max_results=max_results)
#             return [r.get("body", "") for r in results if r.get("body")]
#     except Exception:
#         return []


# # ─────────────────────────────
# # JSON EXTRACTION ROBUSTE
# # ─────────────────────────────
# def extract_json(text):
#     # 1. tentative directe
#     try:
#         return json.loads(text)
#     except:
#         pass

#     # 2. extraction non-greedy
#     match = re.search(r"\{.*?\}", text, re.DOTALL)
#     if match:
#         try:
#             return json.loads(match.group())
#         except:
#             pass

#     return {}


# # ─────────────────────────────
# # MAIN FUNCTION
# # ─────────────────────────────
# def search_appliance_specs(brand: str, serial: str = "", appliance_type: str = ""):

#     try:
#         # ── 1. SEARCH WEB ──
#         query = f"{brand} {serial} {appliance_type} kWh consumption energy label specs"
#         results = web_search(query)

#         context = "\n".join(results[:5]) if results else "Aucune information trouvée"

#         # ── 2. PROMPT STRICT ──
#         prompt = f"""
# Tu es un expert en électroménager.

# Infos web:
# {context}

# IMPORTANT:
# - Réponds uniquement en JSON valide
# - Aucun texte avant ou après
# - Si inconnu mets null

# Format:
# {{
#   "label": "string",
#   "kwh_per_year": number,
#   "annee_fabrication": number,
#   "classe_energie": "string",
#   "source": "string",
#   "confiance": "haute/moyenne/faible"
# }}
# """

#         # ── 3. CALL LLM ──
#         response = client.chat.completions.create(
#             model="meta-llama/llama-4-scout-17b-16e-instruct",
#             messages=[{"role": "user", "content": prompt}],
#             temperature=0.1,
#             max_tokens=300,
#         )

#         text = response.choices[0].message.content.strip()

#         # ── 4. PARSE JSON SÉCURISÉ ──
#         data = extract_json(text)

#         if not data:
#             return {
#                 "success": False,
#                 "error": "JSON invalide",
#                 "raw": text
#             }

#         # ── 5. CALCUL AGE ──
#         year = data.get("annee_fabrication")
#         current_year = datetime.now().year

#         if isinstance(year, int) and year > 1900:
#             data["age_ans"] = current_year - year
#         else:
#             data["age_ans"] = None

#         return {
#             "success": True,
#             "data": data
#         }

#     except Exception as e:
#         return {
#             "success": False,
#             "error": str(e)
#         }
import json
import re
from ddgs import DDGS
from datetime import datetime
from core.services import call_tokenfactory



# ─────────────────────────────
# 🔍 WEB SEARCH
# ─────────────────────────────
def web_search(query, max_results=5):
    try:
        with DDGS() as ddgs:
            results = ddgs.text(query, max_results=max_results)
            return [r.get("body", "") for r in results if r.get("body")]
    except Exception as e:
        print("WEB SEARCH ERROR:", e)
        return []


# ─────────────────────────────
# 🧠 EXTRACTION JSON ROBUSTE
# ─────────────────────────────
def extract_json(text):
    # 1. tentative directe
    try:
        return json.loads(text)
    except:
        pass

    # 2. extraction JSON non-greedy
    match = re.search(r"\{.*?\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except:
            pass

    return {}


# ─────────────────────────────
# ⚙️ FALLBACK INTELLIGENT
# ─────────────────────────────
def fallback_estimation(appliance_type):
    if appliance_type == "refrigerateur":
        return 250
    elif appliance_type == "climatiseur":
        return 900
    elif appliance_type == "machine_laver":
        return 150
    elif appliance_type == "chauffe_eau":
        return 1200
    elif appliance_type == "ampoule":
        return 10
    return None


# ─────────────────────────────
# 🚀 MAIN FUNCTION
# ─────────────────────────────
def search_appliance_specs(brand: str, serial: str = "", appliance_type: str = ""):

    try:
        # ── 1. QUERY INTELLIGENTE ──
        query = f"{brand} {serial} {appliance_type} specifications energy consumption kWh per year"
        results = web_search(query)

        context = "\n".join(results[:5]) if results else "No data found"

        # ── 2. PROMPT STRICT ──
        prompt = f"""
Tu es un expert en électroménager.

Infos web:
{context}

IMPORTANT:
- Réponds uniquement en JSON valide
- Aucun texte avant ou après
- Si inconnu mets null

Format:
{{
  "label": "string",
  "kwh_per_year": number,
  "annee_fabrication": number,
  "classe_energie": "string",
  "source": "string",
  "confiance": "haute/moyenne/faible"
}}
"""

        # ── 3. APPEL LLM ──
        text = call_tokenfactory(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=300,
        )

        # 🔍 DEBUG
        print("LLM RAW:", text)

        # ── 4. PARSE JSON ──
        data = extract_json(text)

        print("PARSED:", data)

        # ── 5. SI JSON VIDE → fallback ──
        if not data:
            data = {}

        # ── 6. VALEURS PAR DÉFAUT ──
        data.setdefault("label", brand or "Inconnu")
        data.setdefault("kwh_per_year", None)
        data.setdefault("annee_fabrication", None)
        data.setdefault("classe_energie", "Inconnue")
        data.setdefault("source", "Web")
        data.setdefault("confiance", "faible")

        # ── 7. FALLBACK kWh ──
        if not data["kwh_per_year"]:
            data["kwh_per_year"] = fallback_estimation(appliance_type)

        # ── 8. CALCUL AGE ──
        year = data.get("annee_fabrication")
        current_year = datetime.now().year

        if isinstance(year, int) and 1900 < year <= current_year:
            data["age_ans"] = current_year - year
        else:
            data["age_ans"] = None

        return {
            "success": True,
            "data": data
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }
