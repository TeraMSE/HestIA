import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { usePropertyStore } from "@/shared/store/usePropertyStore";
import ModelViewer3D from "@/components/viewers/ModelViewer3D";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import api from "@/services/api";

export default function Property3D() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { fetchProperty, selectedProperty } = usePropertyStore();
  const [isLoading, setIsLoading] = useState(true);
  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  const [panoramaUrl, setPanoramaUrl] = useState<string | null>(null);
  const [activePanoramaIndex, setActivePanoramaIndex] = useState(0);

  useEffect(() => {
    if (!id) return;

    const loadProperty = async () => {
      setIsLoading(true);
      try {
        const property = await fetchProperty(parseInt(id));

        if (property && property.panoramas && property.panoramas.length > 0) {
          const completedPanorama = property.panoramas.find((p) => p.status === "completed");

          if (completedPanorama && completedPanorama.job_id) {
            try {
              const response = await api.get(`/jobs/${completedPanorama.job_id}/status/`);
              if (response.data.artifacts?.mesh_url) {
                setMeshUrl(response.data.artifacts.mesh_url);
              }
              if (response.data.artifacts?.panorama_url) {
                setPanoramaUrl(response.data.artifacts.panorama_url);
              }
            } catch {
              console.error("Failed to fetch artifacts");
            }
          }
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadProperty();
  }, [id, fetchProperty]);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <div className="text-xl font-semibold mb-4">Loading 3D Model...</div>
          <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      </div>
    );
  }

  if (!selectedProperty || !meshUrl) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <div className="text-xl font-semibold mb-4">3D Model Not Available</div>
          <Button onClick={() => navigate("/map")} className="mt-4">
            Back to Map
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/map")}
          className="bg-white/10 hover:bg-white/20 text-white"
        >
          <ArrowLeft className="w-6 h-6" />
        </Button>
      </div>

      <div className="flex-1 relative">
        <ModelViewer3D plyUrl={meshUrl} panoramaUrl={panoramaUrl} />
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-6">
        <div className="max-w-2xl mx-auto bg-black/70 rounded-lg p-6 text-white backdrop-blur">
          <h1 className="text-2xl font-bold mb-2">{selectedProperty.address}</h1>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <div className="text-gray-400 text-sm">Bedrooms</div>
              <div className="text-lg font-semibold">{selectedProperty.bedrooms}</div>
            </div>
            <div>
              <div className="text-gray-400 text-sm">Bathrooms</div>
              <div className="text-lg font-semibold">{selectedProperty.bathrooms}</div>
            </div>
            {selectedProperty.area_m2 && (
              <div>
                <div className="text-gray-400 text-sm">Area</div>
                <div className="text-lg font-semibold">{selectedProperty.area_m2} m²</div>
              </div>
            )}
            {selectedProperty.price_tnd && (
              <div>
                <div className="text-gray-400 text-sm">Price</div>
                <div className="text-lg font-semibold">{selectedProperty.price_tnd} TND</div>
              </div>
            )}
          </div>

          {selectedProperty.description && (
            <div className="text-gray-300 text-sm">{selectedProperty.description}</div>
          )}

          <div className="mt-4 flex gap-3">
            <Button onClick={() => navigate("/map")} variant="outline">
              Back to Map
            </Button>
            {user?.role === "landlord" && selectedProperty.owner === user.id && (
              <Button onClick={() => navigate(`/properties/${selectedProperty.id}/edit`)}>
                Edit Property
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
