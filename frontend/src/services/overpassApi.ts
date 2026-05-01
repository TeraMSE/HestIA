/**
 * Overpass API — routed through the Django backend proxy to avoid CORS.
 *
 * Direct browser→Overpass requests are blocked (CORS + 406) when the frontend
 * is served from a non-standard origin (e.g. VS Code dev tunnels).
 * The backend fetches Overpass server-side and re-serves the result.
 */
import { POINode, PoiType } from "@/contracts/types";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";
const PROXY_URL = `${API_BASE_URL}/api/v1/pois/`;

export const overpassApi = {
  async fetchPOIs(
    bounds: { s: number; w: number; n: number; e: number },
    types: PoiType[]
  ): Promise<POINode[]> {
    if (types.length === 0) return [];

    let queryBody = "";
    const b = `${bounds.s},${bounds.w},${bounds.n},${bounds.e}`;

    if (types.includes("hospital")) {
      queryBody += `node["amenity"="hospital"](${b});`;
      queryBody += `node["amenity"="clinic"](${b});`;
    }
    if (types.includes("school")) {
      queryBody += `node["amenity"="school"](${b});`;
      queryBody += `node["amenity"="university"](${b});`;
    }
    if (types.includes("commodity")) {
      queryBody += `node["shop"="supermarket"](${b});`;
      queryBody += `node["shop"="convenience"](${b});`;
      queryBody += `node["shop"="mall"](${b});`;
    }

    if (!queryBody) return [];

    const query = `[out:json][timeout:10];(${queryBody});out body;`;

    try {
      const response = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) return [];

      const data = await response.json();

      const nodes: POINode[] = (data.elements || []).map((el: any) => {
        let type: PoiType = "other";
        if (el.tags?.amenity === "hospital" || el.tags?.amenity === "clinic") type = "hospital";
        else if (el.tags?.amenity === "school" || el.tags?.amenity === "university") type = "school";
        else if (el.tags?.shop) type = "commodity";

        return {
          id: el.id.toString(),
          lat: el.lat,
          lng: el.lon,
          type,
          name: el.tags?.name,
        };
      });

      return nodes;
    } catch {
      return [];
    }
  },
};
