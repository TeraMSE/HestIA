# state_detector.py
import base64
from core.services import call_tokenfactory_vision

def detect_state(image_path: str) -> str:
    with open(image_path, "rb") as f:
        img_bytes = f.read()

    prompt = (
        "Regarde cet appareil électroménager. "
        "Réponds UNIQUEMENT avec un seul mot parmi ces 4 choix : "
        "propre / normal / endommagé / rouillé. "
        "Aucun autre mot, aucune explication."
    )

    result = call_tokenfactory_vision(
        image_bytes=img_bytes,
        prompt=prompt,
        max_tokens=10,
        temperature=0.1
    ).strip().lower()

    valid = ["propre", "normal", "endommagé", "rouillé"]
    for v in valid:
        if v in result:
            return v
    return "normal"
