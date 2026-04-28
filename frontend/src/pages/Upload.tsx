import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore, type UserRole } from "@/shared/store/useAuthStore";
import { usePropertyStore, type Property } from "@/shared/store/usePropertyStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import api from "@/services/api";

export default function Upload() {
  const { user } = useAuthStore();
  const { myProperties, fetchMyProperties } = usePropertyStore();
  const navigate = useNavigate();

  const [step, setStep] = useState<"property" | "upload">("property");
  const [selectedProperty, setSelectedProperty] = useState<number | null>(null);
  const [showCreateProperty, setShowCreateProperty] = useState(false);
  const [panoramaFile, setPanoramaFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"queued" | "running" | "completed" | "failed">("queued");

  const [newProperty, setNewProperty] = useState({
    address: "",
    lat: "",
    lng: "",
    bedrooms: 1,
    bathrooms: 1,
    area_m2: 0,
    price_tnd: "",
    for_rent: false,
    for_sale: false,
    description: "",
  });

  useEffect(() => {
    if (user?.role === "landlord") {
      fetchMyProperties();
    }
  }, [user, fetchMyProperties]);

  const handleCreateProperty = async () => {
    if (!newProperty.address || !newProperty.lat || !newProperty.lng) {
      toast.error("Please fill in address and location");
      return;
    }

    try {
      const response = await api.post("/properties/", {
        ...newProperty,
        lat: parseFloat(newProperty.lat),
        lng: parseFloat(newProperty.lng),
      });
      setSelectedProperty(response.data.id);
      setShowCreateProperty(false);
      setStep("upload");
      toast.success("Property created!");
    } catch {
      toast.error("Failed to create property");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setPanoramaFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedProperty || !panoramaFile) {
      toast.error("Please select property and file");
      return;
    }

    const formData = new FormData();
    formData.append("property_id", selectedProperty.toString());
    formData.append("image", panoramaFile);

    setIsUploading(true);
    try {
      const response = await api.post("/panoramas/upload/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setJobId(response.data.job_id);
      setJobStatus("queued");
      toast.success("Panorama upload started!");
      pollJobStatus(response.data.job_id);
    } catch {
      toast.error("Upload failed");
      setIsUploading(false);
    }
  };

  const pollJobStatus = async (jobId: string, attempt = 0) => {
    const MAX_ATTEMPTS = 120;
    const POLL_INTERVAL = 2000;

    if (attempt >= MAX_ATTEMPTS) {
      toast.error("Job processing timeout");
      return;
    }

    try {
      const response = await api.get(`/jobs/${jobId}/status/`);
      const status = response.data.state;
      setJobStatus(status);

      if (status === "completed") {
        setIsUploading(false);
        toast.success("Panorama processing complete!");
        setTimeout(() => {
          navigate(`/properties/${selectedProperty}/3d`);
        }, 2000);
      } else if (status === "failed") {
        setIsUploading(false);
        toast.error("Panorama processing failed");
      } else {
        setTimeout(() => pollJobStatus(jobId, attempt + 1), POLL_INTERVAL);
      }
    } catch {
      setTimeout(() => pollJobStatus(jobId, attempt + 1), POLL_INTERVAL);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Upload Panorama</h1>
        <p className="text-gray-600 mb-8">
          {user?.role === "landlord"
            ? "Upload a 360° panorama of your property to generate a 3D model"
            : "Upload a panorama from your property inspection"}
        </p>

        {step === "property" && (
          <div className="space-y-6">
            <div>
              <Label>Select Property</Label>
              <div className="mt-3 space-y-2">
                {myProperties.map((prop) => (
                  <button
                    key={prop.id}
                    onClick={() => {
                      setSelectedProperty(prop.id);
                      setStep("upload");
                    }}
                    className={`w-full p-4 text-left border-2 rounded-lg transition ${
                      selectedProperty === prop.id
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="font-semibold">{prop.address}</div>
                    <div className="text-sm text-gray-600">
                      {prop.bedrooms} bed • {prop.bathrooms} bath
                    </div>
                  </button>
                ))}
              </div>

              {user?.role === "landlord" && (
                <Button
                  variant="outline"
                  className="w-full mt-4"
                  onClick={() => setShowCreateProperty(!showCreateProperty)}
                >
                  {showCreateProperty ? "Cancel" : "Create New Property"}
                </Button>
              )}
            </div>

            {showCreateProperty && (
              <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                <Input
                  placeholder="Address"
                  value={newProperty.address}
                  onChange={(e) =>
                    setNewProperty({ ...newProperty, address: e.target.value })
                  }
                />
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    placeholder="Latitude"
                    type="number"
                    step="0.000001"
                    value={newProperty.lat}
                    onChange={(e) =>
                      setNewProperty({ ...newProperty, lat: e.target.value })
                    }
                  />
                  <Input
                    placeholder="Longitude"
                    type="number"
                    step="0.000001"
                    value={newProperty.lng}
                    onChange={(e) =>
                      setNewProperty({ ...newProperty, lng: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    placeholder="Bedrooms"
                    type="number"
                    value={newProperty.bedrooms}
                    onChange={(e) =>
                      setNewProperty({
                        ...newProperty,
                        bedrooms: parseInt(e.target.value),
                      })
                    }
                  />
                  <Input
                    placeholder="Bathrooms"
                    type="number"
                    value={newProperty.bathrooms}
                    onChange={(e) =>
                      setNewProperty({
                        ...newProperty,
                        bathrooms: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={handleCreateProperty}
                >
                  Create Property
                </Button>
              </div>
            )}
          </div>
        )}

        {step === "upload" && (
          <div className="space-y-6">
            {jobId ? (
              <div className="text-center">
                <div className="inline-flex flex-col items-center">
                  <div className="text-lg font-semibold mb-4">
                    {jobStatus === "completed" && "✓ Processing Complete!"}
                    {jobStatus === "running" && "⏳ Processing..."}
                    {jobStatus === "queued" && "⏱ Queued..."}
                    {jobStatus === "failed" && "✗ Processing Failed"}
                  </div>
                  <div className="w-48 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all"
                      style={{
                        width:
                          jobStatus === "completed"
                            ? "100%"
                            : jobStatus === "running"
                              ? "60%"
                              : "20%",
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <Label>Upload Panorama Image</Label>
                  <div className="mt-3 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-indigo-500 transition cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                      id="panorama-input"
                      disabled={isUploading}
                    />
                    <label htmlFor="panorama-input" className="cursor-pointer">
                      {panoramaFile ? (
                        <>
                          <div className="text-lg font-semibold">✓ {panoramaFile.name}</div>
                          <div className="text-sm text-gray-500">Click to change</div>
                        </>
                      ) : (
                        <>
                          <div className="text-lg font-semibold">Drag and drop your panorama</div>
                          <div className="text-sm text-gray-500">or click to select</div>
                        </>
                      )}
                    </label>
                  </div>
                </div>

                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleUpload}
                  disabled={isUploading || !panoramaFile}
                >
                  {isUploading ? "Uploading..." : "Upload & Process"}
                </Button>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setStep("property")}
                  disabled={isUploading}
                >
                  Back
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
