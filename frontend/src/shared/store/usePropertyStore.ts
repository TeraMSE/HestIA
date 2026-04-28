import { create } from "zustand";
import api from "@/services/api";

export interface Panorama {
  id: number;
  property: number;
  uploaded_by: number;
  job_id: string | null;
  status: "uploading" | "processing" | "completed" | "failed";
  created_at: string;
  completed_at: string | null;
  error_message: string;
}

export interface Property {
  id: number;
  address: string;
  lat: string;
  lng: string;
  bedrooms: number;
  bathrooms: number;
  area_m2: number | null;
  price_tnd: string | null;
  for_sale: boolean;
  for_rent: boolean;
  owner: number;
  owner_email: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  panoramas?: Panorama[];
  images?: any[];
  panorama_count?: number;
}

interface PropertyStore {
  properties: Property[];
  myProperties: Property[];
  selectedProperty: Property | null;
  isLoading: boolean;
  error: string | null;
  fetchProperties: (params?: any) => Promise<void>;
  fetchMyProperties: () => Promise<void>;
  fetchProperty: (id: number) => Promise<Property | null>;
  createProperty: (data: Partial<Property>) => Promise<Property>;
  updateProperty: (id: number, data: Partial<Property>) => Promise<Property>;
  deleteProperty: (id: number) => Promise<void>;
  selectProperty: (property: Property | null) => void;
}

export const usePropertyStore = create<PropertyStore>((set, get) => ({
  properties: [],
  myProperties: [],
  selectedProperty: null,
  isLoading: false,
  error: null,

  fetchProperties: async (params = {}) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.get("/properties/", { params });
      set({ properties: response.data.results || response.data, isLoading: false });
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || error.message || "Failed to fetch properties",
        isLoading: false,
      });
    }
  },

  fetchMyProperties: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.get("/properties/my_properties/");
      set({ myProperties: response.data, isLoading: false });
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || error.message || "Failed to fetch your properties",
        isLoading: false,
      });
    }
  },

  fetchProperty: async (id: number) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.get(`/properties/${id}/`);
      const property = response.data;
      set({ selectedProperty: property, isLoading: false });
      return property;
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || error.message || "Failed to fetch property",
        isLoading: false,
      });
      return null;
    }
  },

  createProperty: async (data: Partial<Property>) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post("/properties/", data);
      const newProperty = response.data;
      set((state) => ({
        properties: [newProperty, ...state.properties],
        myProperties: [newProperty, ...state.myProperties],
        isLoading: false,
      }));
      return newProperty;
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || error.message || "Failed to create property",
        isLoading: false,
      });
      throw error;
    }
  },

  updateProperty: async (id: number, data: Partial<Property>) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.patch(`/properties/${id}/`, data);
      const updatedProperty = response.data;
      set((state) => ({
        properties: state.properties.map((p) => (p.id === id ? updatedProperty : p)),
        myProperties: state.myProperties.map((p) => (p.id === id ? updatedProperty : p)),
        selectedProperty: state.selectedProperty?.id === id ? updatedProperty : state.selectedProperty,
        isLoading: false,
      }));
      return updatedProperty;
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || error.message || "Failed to update property",
        isLoading: false,
      });
      throw error;
    }
  },

  deleteProperty: async (id: number) => {
    set({ isLoading: true, error: null });
    try {
      await api.delete(`/properties/${id}/`);
      set((state) => ({
        properties: state.properties.filter((p) => p.id !== id),
        myProperties: state.myProperties.filter((p) => p.id !== id),
        selectedProperty: state.selectedProperty?.id === id ? null : state.selectedProperty,
        isLoading: false,
      }));
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || error.message || "Failed to delete property",
        isLoading: false,
      });
      throw error;
    }
  },

  selectProperty: (property: Property | null) => {
    set({ selectedProperty: property });
  },
}));
