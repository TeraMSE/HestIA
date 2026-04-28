import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/shared/store/useAuthStore";
import Onboarding from "./Onboarding";

const Index = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate("/map");
    }
  }, [user, navigate]);

  if (user) return null;

  return <Onboarding />;
};

export default Index;
