import { POINode, PoiType } from "@/contracts/types";

export const overpassApi = {
  async fetchPOIs(bounds: { s: number; w: number; n: number; e: number }, types: PoiType[]): Promise<POINode[]> {
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
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      if (!response.ok) throw new Error("Overpass API error");
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
    } catch (e) {
      console.error("Overpass API fetch failed:", e);
      return [];
    }
  }
};
