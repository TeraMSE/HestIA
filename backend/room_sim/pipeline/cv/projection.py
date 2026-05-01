import cv2
import numpy as np
from typing import Dict, Tuple

class ERP2Cubemap:
    """
    Handles Equirectangular Projection (ERP) to Cubemap face conversion 
    and spatial coordinate tracking.
    """
    FACE_NAMES = ["front", "back", "left", "right", "top", "bottom"]

    def __init__(self, erp_width: int, erp_height: int, face_size: int):
        self.erp_width = erp_width
        self.erp_height = erp_height
        self.face_size = face_size
        self._build_mappings()

    def _build_mappings(self) -> None:
        """
        Precomputes the spatial mappings (u, v) for all 6 faces from ERP coordinates.
        """
        self.maps = {}
        
        for face_id in range(6):
            map_x, map_y = self._get_face_mapping(face_id)
            self.maps[self.FACE_NAMES[face_id]] = (map_x, map_y)

    def _get_face_mapping(self, face_id: int) -> Tuple[np.ndarray, np.ndarray]:
        """
        Creates the spatial mapping matrices for a specific cubemap face.
        """
        x, y = np.meshgrid(np.arange(self.face_size), np.arange(self.face_size))
        
        # Normalize to [-1, 1]
        nx = 2.0 * x / self.face_size - 1.0
        ny = 2.0 * y / self.face_size - 1.0
        
        # Mapping rules for the 6 faces layout towards 3D normalized coordinates (X, Y, Z)
        # Assuming camera looks towards +X for 'front'
        
        if face_id == 0:   # Front
            X, Y, Z = np.ones_like(nx), -nx, -ny
        elif face_id == 1: # Back
            X, Y, Z = -np.ones_like(nx), nx, -ny
        elif face_id == 2: # Left
            X, Y, Z = nx, np.ones_like(nx), -ny
        elif face_id == 3: # Right
            X, Y, Z = -nx, -np.ones_like(nx), -ny
        elif face_id == 4: # Top
            X, Y, Z = -ny, -nx, np.ones_like(nx)
        elif face_id == 5: # Bottom
            X, Y, Z = ny, -nx, -np.ones_like(nx)
        else:
            raise ValueError("Invalid face ID")

        # Convert to spherical coordinates phi [-pi, pi], theta [-pi/2, pi/2]
        r = np.sqrt(X**2 + Y**2 + Z**2)
        phi = np.arctan2(Y, X)
        theta = np.arcsin(Z / r)
        
        # Convert spherical coordinates to ERP pixel coordinates
        # phi is mapped to u [0, erp_width-1]
        u = (phi / (2 * np.pi) + 0.5) * (self.erp_width - 1)
        # theta is mapped to v [0, erp_height-1]
        v = (theta / np.pi + 0.5) * (self.erp_height - 1)
        
        return u.astype(np.float32), v.astype(np.float32)

    def process(self, erp_img: np.ndarray) -> Dict[str, np.ndarray]:
        """
        Takes an ERP image and returns a dictionary of the 6 cubemap faces.
        """
        if erp_img.shape[0] != self.erp_height or erp_img.shape[1] != self.erp_width:
            raise ValueError(f"Expected ERP image of size {self.erp_width}x{self.erp_height}, got {erp_img.shape[1]}x{erp_img.shape[0]}")
            
        faces = {}
        for face_name in self.FACE_NAMES:
            map_x, map_y = self.maps[face_name]
            faces[face_name] = cv2.remap(erp_img, map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)
            
        return faces
