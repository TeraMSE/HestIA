import cv2
import numpy as np
from typing import List, Dict, Any


class ClosedVocabDetector:
    """
    Closed-vocabulary detector that loads the custom-trained best.pt YOLOv8 model.
    Class names are baked into the checkpoint — no set_classes() needed.
    """

    def __init__(self, model_path: str = "backend/checkpoints/best.pt"):
        """
        Load the custom YOLOv8 checkpoint from `model_path`.
        """
        from ultralytics import YOLO
        from room_sim.pipeline.gpu_utils import get_device
        _device = get_device()
        self.model = YOLO(model_path)
        self.model.to(_device)
        # Expose fixed class names so downstream code can read the vocab
        self.class_names: List[str] = list(self.model.names.values())

    def detect(self, img: np.ndarray, face_name: str, conf_threshold: float = 0.3) -> List[Dict[str, Any]]:
        """
        Run inference on a single image array (e.g. a cubemap face).
        Returns a list of structured detection objects.
        """
        results = self.model.predict(img, conf=conf_threshold, verbose=False)

        detections = []
        if len(results) == 0:
            return detections

        result = results[0]

        boxes    = result.boxes.xyxy.cpu().numpy()   # x_min, y_min, x_max, y_max
        confs    = result.boxes.conf.cpu().numpy()
        class_ids = result.boxes.cls.cpu().numpy()

        for box, conf, cls_id in zip(boxes, confs, class_ids):
            x_min, y_min, x_max, y_max = map(float, box)
            label = self.class_names[int(cls_id)]

            detections.append({
                "class_name":       label,
                "confidence_score": float(conf),
                "cubemap_face":     face_name,
                "cubemap_bbox":     [x_min, y_min, x_max, y_max],
            })

        return detections


class OpenVocabDetector:
    """
    Zero-shot open-vocabulary detector using YOLO-World.
    Retained for:
      - The appliance-scanner kitchen path (needs fridge / AC / washing machine / water heater).
      - The window-scan fallback path (_run_fresh_window_detection in views.py).
    Not used by the main reconstruction pipeline any more.
    """

    def __init__(self, model_name: str = "yolov8x-worldv2.pt", classes: List[str] = None):
        """
        Initialise YOLO-World and set the target vocabulary.
        """
        from ultralytics import YOLOWorld
        from room_sim.pipeline.gpu_utils import get_device
        _device = get_device()
        self.model = YOLOWorld(model_name)
        self.model.to(_device)
        if classes is None:
            classes = ["appliance", "furniture", "window"]
        self.model.set_classes(classes)
        self.classes = classes

    def detect(self, img: np.ndarray, face_name: str, conf_threshold: float = 0.3) -> List[Dict[str, Any]]:
        """
        Run inference on a single image array.
        Returns a list of structured detection objects.
        """
        results = self.model.predict(img, conf=conf_threshold, verbose=False)

        detections = []
        if len(results) == 0:
            return detections

        result = results[0]

        boxes    = result.boxes.xyxy.cpu().numpy()
        confs    = result.boxes.conf.cpu().numpy()
        class_ids = result.boxes.cls.cpu().numpy()

        for box, conf, cls_id in zip(boxes, confs, class_ids):
            x_min, y_min, x_max, y_max = map(float, box)
            label = self.classes[int(cls_id)]

            detections.append({
                "class_name":       label,
                "confidence_score": float(conf),
                "cubemap_face":     face_name,
                "cubemap_bbox":     [x_min, y_min, x_max, y_max],
            })

        return detections
