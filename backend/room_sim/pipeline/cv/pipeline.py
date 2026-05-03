import cv2
import json
import argparse
import os
from typing import Dict, Any, List

from .projection import ERP2Cubemap
from .detector import OpenVocabDetector
from .post_process import Reprojector

# Read DETECTOR_BACKEND via python-decouple so .env is honoured.
# Falls back to os.environ for CLI usage outside Django.
try:
    from decouple import config as _decouple_config
    _BACKEND = _decouple_config("DETECTOR_BACKEND", default="yoloworld").strip().lower()
except Exception:
    _BACKEND = os.environ.get("DETECTOR_BACKEND", "yoloworld").strip().lower()

print(f"[CV] Detector backend: {_BACKEND}")

# Upgraded YOLOWorld default (x-size v2 — better recall on indoor vocab)
_DEFAULT_YOLO_MODEL = "yolov8x-worldv2.pt"


def _build_detector(model_name: str, classes: List[str] | None,
                    fallback_model: str | None = None):
    """Try Grounding DINO first if requested; fall back to YOLOWorld with the
    correct default checkpoint — never pass a non-existent name like 'gdino'."""
    # Resolve which YOLO model to use for the fallback path.
    # If model_name looks like a path/file, use it; otherwise use the default.
    yolo_model = fallback_model or (
        model_name if model_name.endswith(".pt") else _DEFAULT_YOLO_MODEL
    )
    """Try Grounding DINO first if requested; fall back to YOLOWorld silently."""
    if _BACKEND == "gdino":
        try:
            from .grounding_dino_detector import GroundingDINODetector
            print("Initializing Grounding DINO Detector…")
            det = GroundingDINODetector(classes=classes)
            print("[CV] Grounding DINO ready.")
            return det
        except ImportError as e:
            print(f"[warn] groundingdino-py import failed ({e}) — falling back to YOLO-World.")
        except Exception as exc:
            print(f"[warn] Grounding DINO init failed ({exc}) — falling back to YOLO-World.")
    print(f"Initializing YOLO-World Detector ({yolo_model})...")
    return OpenVocabDetector(model_name=yolo_model, classes=classes)


class ZeroShotERPPipeline:
    """
    End-to-End Orchestrator for mapping ERP -> Cubemaps -> Object Detection -> Reprojection ERP -> JSON
    """
    def __init__(self, erp_width: int = 4096, erp_height: int = 2048, face_size: int = 1024,
                 model_name: str = _DEFAULT_YOLO_MODEL, classes: List[str] = None,
                 fallback_model: str | None = None):
        self.erp_width = erp_width
        self.erp_height = erp_height
        self.face_size = face_size

        print("Initializing ERP2Cubemap Mappings...")
        self.projection = ERP2Cubemap(erp_width, erp_height, face_size)

        self.detector = _build_detector(model_name, classes, fallback_model=fallback_model)

        print("Initializing ERP Reprojector...")
        self.reprojector = Reprojector(erp_width, erp_height, face_size)

    def run(self, erp_path: str, conf_threshold: float = 0.3, debug: bool = False,
            save_faces_dir: str | None = None) -> Dict[str, Any]:
        """
        Executes the detection pipeline on a single ERP image.

        Args:
            erp_path: Path to the equirectangular panorama.
            conf_threshold: YOLO confidence threshold.
            debug: Save annotated cubemap faces for debugging.
            save_faces_dir: If provided, the 6 cubemap face images are saved as
                            JPEG files to this directory so downstream consumers
                            (e.g. the appliance scanner) can crop from them
                            without regenerating the cubemap projection.
        """
        print(f"Loading '{erp_path}'...")
        erp_img = cv2.imread(erp_path)

        if erp_img is None:
            raise FileNotFoundError(f"Image not found at path: {erp_path}")

        erp_img = cv2.resize(erp_img, (self.erp_width, self.erp_height))

        print("Converting ERP to Cubemaps...")
        faces = self.projection.process(erp_img)

        # Optionally persist the 6 face images so other pipeline steps can use
        # them without repeating the expensive ERP→Cubemap remap.
        if save_faces_dir is not None:
            os.makedirs(save_faces_dir, exist_ok=True)
            for face_name, face_img in faces.items():
                cv2.imwrite(os.path.join(save_faces_dir, f"{face_name}.jpg"), face_img)
            print(f"Saved 6 cubemap faces to '{save_faces_dir}'.")

        all_detections = []

        print("Running Zero-Shot Detection...")
        for face_name, face_img in faces.items():
            print(f"  -> Inferring on '{face_name}' face...")
            detections = self.detector.detect(face_img, face_name, conf_threshold)
            all_detections.extend(detections)

            if debug and detections:
                debug_img = face_img.copy()
                for d in detections:
                    if d["cubemap_face"] == face_name:
                        x1, y1, x2, y2 = map(int, d["cubemap_bbox"])
                        cv2.rectangle(debug_img, (x1, y1), (x2, y2), (0, 255, 0), 2)
                        cv2.putText(debug_img, f'{d["class_name"]} {d["confidence_score"]:.2f}', (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                cv2.imwrite(f'debug_{face_name}.jpg', debug_img)

        print("Reprojecting Coordinates and applying NMS...")
        final_detections = self.reprojector.process(all_detections)

        # Build clean JSON output — cubemap_bbox is preserved so downstream
        # steps can crop directly from the saved face images (no re-projection).
        results = {
            "source_image": os.path.basename(erp_path),
            "erp_resolution": [self.erp_width, self.erp_height],
            "cubemap_resolution": self.face_size,
            "detections": [
                {
                    "class_name": d["class_name"],
                    "confidence_score": round(float(d["confidence_score"]), 4),
                    "cubemap_face": d["cubemap_face"],
                    "cubemap_bbox": [round(float(c), 2) for c in d["cubemap_bbox"]],
                    "erp_bounding_box": [round(float(c), 2) for c in d["erp_bounding_box"]],
                }
                for d in final_detections
            ]
        }

        print(f"Detected {len(final_detections)} objects.")
        return results

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Zero-Shot ERP Object Detection Pipeline")
    parser.add_argument("--input", "-i", type=str, required=True, help="Path to input ERP panorama image")
    parser.add_argument("--output", "-o", type=str, default="detections.json", help="Path to output JSON file")
    parser.add_argument("--conf", "-c", type=float, default=0.3, help="Confidence threshold")
    parser.add_argument("--model", "-m", type=str, default=_DEFAULT_YOLO_MODEL, help=f"YOLO-World model to use (default: {_DEFAULT_YOLO_MODEL})")
    parser.add_argument("--classes", type=str, nargs="+", 
                        default=["bed", "wardrobe", "closet", "chair", "desk", "nightstand", "table", "television", "monitor", "lamp", "ceiling light", "window", "door", "rug", "mirror", "curtain", "air conditioner", "painting", "sofa", "refrigerator"], 
                        help="Target classes for zero-shot detection")
    parser.add_argument("--debug", action="store_true", help="Save debug images of cubemap faces with bounding boxes drawn")
    args = parser.parse_args()

    pipeline = ZeroShotERPPipeline(model_name=args.model, classes=args.classes)
    results = pipeline.run(args.input, args.conf, debug=args.debug)
    with open(args.output, "w") as f:
        json.dump(results, f, indent=4)
    print(f"Saved {len(results['detections'])} detections to '{args.output}'")


