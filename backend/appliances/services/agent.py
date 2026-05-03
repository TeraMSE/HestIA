"""
ApplianceVisionAgent — ported from TacheEnergyMaha/appliance_agent.py.
Adapted to use Django settings for model path and to support a
module-level singleton so the 10.5 MB weights are loaded once per process.
"""
import json
import logging
import threading
from pathlib import Path

import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms

from .rule_engine import ApplianceRuleEngine

logger = logging.getLogger(__name__)

_agent = None
_agent_lock = threading.Lock()


def get_agent() -> "ApplianceVisionAgent":
    """Return the cached singleton, initialising it on first call."""
    global _agent
    if _agent is None:
        with _agent_lock:
            if _agent is None:
                from django.conf import settings
                model_path = getattr(settings, "APPLIANCE_CNN_PATH", None)
                if model_path is None or not Path(model_path).is_file():
                    raise RuntimeError(
                        "APPLIANCE_CNN_PATH is not set or the file does not exist. "
                        "Copy mobilenet_best.pth to backend/checkpoints/."
                    )
                class_names_path = (
                    Path(__file__).resolve().parent.parent / "data" / "class_names.json"
                )
                _agent = ApplianceVisionAgent(
                    model_path=str(model_path),
                    class_names_path=str(class_names_path),
                )
    return _agent


class ApplianceVisionAgent:
    """CNN-based appliance detector + EPS rule-engine scorer."""

    _TRANSFORM = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    def __init__(self, model_path: str, class_names_path: str):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.rule_engine = ApplianceRuleEngine()

        with open(class_names_path) as f:
            self.class_names = json.load(f)

        self.model = self._load_model(model_path)
        logger.info("[appliances] ApplianceVisionAgent ready — classes: %s", self.class_names)

    def _load_model(self, model_path: str):
        model = models.mobilenet_v2(weights="MobileNet_V2_Weights.IMAGENET1K_V1")
        model.classifier = nn.Sequential(
            nn.Dropout(p=0.3),
            nn.Linear(model.classifier[1].in_features, 256),
            nn.ReLU(),
            nn.Dropout(p=0.2),
            nn.Linear(256, len(self.class_names)),
        )
        model.load_state_dict(
            torch.load(model_path, map_location=self.device, weights_only=True)
        )
        model.eval()
        return model.to(self.device)

    def predict_image(self, image_path: str) -> dict:
        """Run CNN on a single image file. Returns class name + confidence (0–1)."""
        img = Image.open(image_path).convert("RGB")
        tensor = self._TRANSFORM(img).unsqueeze(0).to(self.device)
        with torch.no_grad():
            probs = torch.softmax(self.model(tensor), dim=1)[0]
            confidence, predicted = torch.max(probs, 0)
        return {
            "class": self.class_names[predicted.item()],
            "confidence": float(confidence.item()),
        }

    def analyze_single(
        self,
        image_path: str,
        *,
        age: int = 7,
        energy_class: str = "?",
        brand: str = "?",
        technology: str = "inconnu",
        kwh_per_year: int = 0,
        etat: str = "normal",
    ) -> dict:
        """
        Full single-image analysis: CNN prediction + rule engine scoring.
        `etat` is the visual condition; pass "normal" when doing automated
        batch scans (skip the LLM vision call for speed).
        """
        pred = self.predict_image(image_path)
        category   = pred["class"]
        confidence = pred["confidence"]

        appliance_data = [{
            "category": category, "age": age, "confidence": confidence,
            "energy_class": energy_class, "brand": brand,
            "technology": technology, "kwh_per_year": kwh_per_year, "etat": etat,
        }]
        global_score, scores, details = self.rule_engine.calculate_score(appliance_data)
        grade = self.rule_engine.get_grade(global_score)
        recommendation = self.rule_engine.get_recommendation(category, global_score, details)

        return {
            "detected_class": category,
            "confidence": round(confidence * 100, 1),
            "etat_visuel": etat,
            "age_years": age,
            "energy_class": energy_class,
            "brand": brand,
            "technology": technology,
            "kwh_per_year": kwh_per_year,
            "efficiency_score": global_score,
            "grade": grade,
            "recommendation": recommendation,
            "score_details": details.get(category, {}),
        }
