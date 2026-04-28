import { useEffect, useRef } from "react";
import * as THREE from "three";

interface ModelViewer3DProps {
  plyUrl: string;
  panoramaUrl?: string;
}

export default function ModelViewer3D({ plyUrl, panoramaUrl }: ModelViewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 5, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const lights = [
      new THREE.DirectionalLight(0xffffff, 0.8),
      new THREE.DirectionalLight(0xffffff, 0.6),
      new THREE.AmbientLight(0xffffff, 0.6),
    ];

    lights[0].position.set(5, 10, 7);
    lights[1].position.set(-5, 10, -7);

    lights.forEach((light) => scene.add(light));

    let geometry: THREE.BufferGeometry | null = null;
    let animationId: number | null = null;

    const parsePLY = (arrayBuffer: ArrayBuffer) => {
      const view = new DataView(arrayBuffer);
      const text = new TextDecoder().decode(new Uint8Array(arrayBuffer.slice(0, 10000)));
      const headerEnd = text.indexOf("end_header");
      const headerText = text.substring(0, headerEnd);

      const vertexCountMatch = headerText.match(/element vertex (\d+)/);
      const vertexCount = vertexCountMatch ? parseInt(vertexCountMatch[1]) : 0;

      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(vertexCount * 3);
      let offset = text.indexOf("end_header") + "end_header\n".length;

      const bytesPerVertex = 12;

      for (let i = 0; i < vertexCount; i++) {
        positions[i * 3 + 0] = view.getFloat32(offset, true);
        positions[i * 3 + 1] = view.getFloat32(offset + 4, true);
        positions[i * 3 + 2] = view.getFloat32(offset + 8, true);
        offset += bytesPerVertex;
      }

      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      return geometry;
    };

    const loadPLY = async () => {
      try {
        const response = await fetch(plyUrl);
        const arrayBuffer = await response.arrayBuffer();
        geometry = parsePLY(arrayBuffer);

        if (geometry.attributes.position) {
          geometry.computeBoundingBox();
          geometry.center();
          geometry.computeVertexNormals();

          const material = new THREE.MeshPhongMaterial({
            color: 0x888888,
            shininess: 30,
            side: THREE.DoubleSide,
          });

          const mesh = new THREE.Mesh(geometry, material);
          scene.add(mesh);
          meshRef.current = mesh;

          const bbox = geometry.boundingBox;
          if (bbox) {
            const size = bbox.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = camera.fov * (Math.PI / 180);
            const distance = maxDim / 2 / Math.tan(fov / 2);
            camera.position.z = distance * 1.5;
            camera.lookAt(mesh.position);
          }
        }
      } catch (error) {
        console.error("Failed to load PLY:", error);
      }
    };

    loadPLY();

    const animate = () => {
      animationId = requestAnimationFrame(animate);

      if (meshRef.current) {
        meshRef.current.rotation.x += 0.0005;
        meshRef.current.rotation.y += 0.001;
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      const newWidth = containerRef.current?.clientWidth || width;
      const newHeight = containerRef.current?.clientHeight || height;

      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
      }
      if (containerRef.current && renderer.domElement.parentElement === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      if (geometry) {
        geometry.dispose();
      }
      renderer.dispose();
    };
  }, [plyUrl]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
      }}
    />
  );
}
