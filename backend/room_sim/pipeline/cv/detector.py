import cv2
import numpy as np
from typing import List, Dict, Any
from ultralytics import YOLOWorld

class OpenVocabDetector:
    """
    Zero-shot open vocabulary detector leveraging YOLO-World.
    Configures Prompts dynamically.
    """
    
    def __init__(self, model_name: str = 'yolov8s-world.pt', classes: List[str] = None):
        """
        Initializes the YOLO-World model and sets standard vocabulary.
        """
        # Ensure the dedicated GPU is selected before model init
        from room_sim.pipeline.gpu_utils import get_device
        _device = get_device()
        self.model = YOLOWorld(model_name)
        self.model.to(_device)
        if classes is None:
            classes = ["appliance", "furniture", "window"]
            
        # Ensure we set the text prompts
        self.model.set_classes(classes)
        self.classes = classes
        
    def detect(self, img: np.ndarray, face_name: str, conf_threshold: float = 0.3) -> List[Dict[str, Any]]:
        """
        Run inference on a single image array (e.g. a cubemap face), filter by confidence.
        Returns a list of structured detection objects.
        """
        # Run inference
        results = self.model.predict(img, conf=conf_threshold, verbose=False)
        
        detections = []
        if len(results) == 0:
            return detections
            
        result = results[0]
        
        # Extract fields
        boxes = result.boxes.xyxy.cpu().numpy()  # x_min, y_min, x_max, y_max
        confs = result.boxes.conf.cpu().numpy()
        class_ids = result.boxes.cls.cpu().numpy()
        
        for box, conf, cls_id in zip(boxes, confs, class_ids):
            x_min, y_min, x_max, y_max = map(float, box)
            label = self.classes[int(cls_id)]
            
            detections.append({
                "class_name": label,
                "confidence_score": float(conf),
                "cubemap_face": face_name,
                "cubemap_bbox": [x_min, y_min, x_max, y_max]
            })
            
        return detections
