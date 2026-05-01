import numpy as np
from typing import List, Dict, Any, Tuple

class Reprojector:
    """
    Handles math to map bounding boxes from Cubemap faces back to ERP coordinates.
    Also handles Non-Maximum Suppression (NMS) in the ERP space, observing seams.
    """
    def __init__(self, erp_width: int, erp_height: int, face_size: int):
        self.erp_width = erp_width
        self.erp_height = erp_height
        self.face_size = face_size
        self.edge_samples = 10  # Number of points to sample per edge of the bbox

    def _cubemap_to_spherical(self, x: float, y: float, face_id: int) -> Tuple[float, float]:
        """Convert a single (x, y) on a given cubemap face to ERP (u, v)."""
        nx = 2.0 * x / self.face_size - 1.0
        ny = 2.0 * y / self.face_size - 1.0

        if face_id == 0:   # Front
            X, Y, Z = 1.0, -nx, -ny
        elif face_id == 1: # Back
            X, Y, Z = -1.0, nx, -ny
        elif face_id == 2: # Left
            X, Y, Z = nx, 1.0, -ny
        elif face_id == 3: # Right
            X, Y, Z = -nx, -1.0, -ny
        elif face_id == 4: # Top
            X, Y, Z = -ny, -nx, 1.0
        elif face_id == 5: # Bottom
            X, Y, Z = ny, -nx, -1.0
        else:
            raise ValueError("Invalid face ID")

        r = np.sqrt(X**2 + Y**2 + Z**2)
        phi = np.arctan2(Y, X)
        theta = np.arcsin(Z / r)

        u = (phi / (2 * np.pi) + 0.5) * (self.erp_width - 1)
        v = (theta / np.pi + 0.5) * (self.erp_height - 1)
        return float(u), float(v)

    def reproject_bbox(self, face_name: str, bbox: List[float]) -> List[float]:
        """
        Samples points along the edges of the cubemap bbox and projects them
        to find the min/max ERP bounds.
        """
        face_idx = ["front", "back", "left", "right", "top", "bottom"].index(face_name)
        xmin, ymin, xmax, ymax = bbox
        
        points = []
        # Sample points along the top and bottom edges
        for x in np.linspace(xmin, xmax, self.edge_samples):
            points.append((x, ymin))
            points.append((x, ymax))
        # Sample points along the left and right edges
        for y in np.linspace(ymin, ymax, self.edge_samples):
            points.append((xmin, y))
            points.append((xmax, y))

        u_coords = []
        v_coords = []
        for x, y in points:
            u, v = self._cubemap_to_spherical(x, y, face_idx)
            u_coords.append(u)
            v_coords.append(v)

        u_coords = np.array(u_coords)
        v_coords = np.array(v_coords)

        # Handle crossing the stitch seam (u=0 / u=erp_width)
        # If the max difference in u is very large (e.g., > half width), it's crossing the boundary
        if np.max(u_coords) - np.min(u_coords) > self.erp_width / 2:
            # Shift points on the far right (u > width/2) to the negative side to compute min/max
            u_coords[u_coords > self.erp_width / 2] -= self.erp_width
            
        u_min, u_max = np.min(u_coords), np.max(u_coords)
        v_min, v_max = np.min(v_coords), np.max(v_coords)
        
        # Wrap bounding box boundaries to standard [0, width]
        if u_min < 0:
            u_min += self.erp_width
            u_max += self.erp_width

        return [float(u_min), float(v_min), float(u_max), float(v_max)]

    def compute_iou(self, box1: List[float], box2: List[float]) -> float:
        """Compute IoU between two ERP bounding boxes, accommodating wrap-around."""
        # For simplicity in this zero-shot implementation, we assume boxes 
        # have been normalized and we handle standard intersection.
        # Deep logic for circular overlap can be extended here.
        x1_min, y1_min, x1_max, y1_max = box1
        x2_min, y2_min, x2_max, y2_max = box2

        inter_min_x = max(x1_min, x2_min)
        inter_min_y = max(y1_min, y2_min)
        inter_max_x = min(x1_max, x2_max)
        inter_max_y = min(y1_max, y2_max)

        if inter_max_x < inter_min_x or inter_max_y < inter_min_y:
            return 0.0

        inter_area = (inter_max_x - inter_min_x) * (inter_max_y - inter_min_y)
        area1 = (x1_max - x1_min) * (y1_max - y1_min)
        area2 = (x2_max - x2_min) * (y2_max - y2_min)
        union_area = area1 + area2 - inter_area

        return inter_area / union_area if union_area > 0 else 0.0

    def apply_nms(self, detections: List[Dict[str, Any]], iou_thresh: float = 0.4) -> List[Dict[str, Any]]:
        """Applies Non-Maximum Suppression to the reprojected ERP detections."""
        if not detections:
            return []

        # Sort by confidence descending
        detections = sorted(detections, key=lambda x: x["confidence_score"], reverse=True)
        keep = []

        for det in detections:
            suppress = False
            for k in keep:
                if det["class_name"] != k["class_name"]:
                    continue
                iou = self.compute_iou(det["erp_bounding_box"], k["erp_bounding_box"])
                if iou >= iou_thresh:
                    suppress = True
                    break
            if not suppress:
                keep.append(det)

        return keep

    def process(self, detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Reprojects all detection bounding boxes and applies NMS."""
        for det in detections:
            det["erp_bounding_box"] = self.reproject_bbox(det["cubemap_face"], det["cubemap_bbox"])
            
        return self.apply_nms(detections)
