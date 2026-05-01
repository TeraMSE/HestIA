"""Generate self-contained HTML for visual simulation playback in Streamlit."""

from __future__ import annotations

import json
from typing import Any


def generate_visual_sim_html(frame_sequence: dict[str, Any]) -> str:
    """Return a self-contained HTML viewer for a visual simulation payload."""
    payload = frame_sequence or {}
    payload_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    html = """
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Domus Visual Simulation</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    html, body, #root { height: 100%; margin: 0; }
    body { background: #f8fafc; overflow: hidden; font-family: Inter, system-ui, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    window.__SIM_DATA__ = __SIM_DATA_JSON__;
  </script>

  <script type="text/babel">
    const { useEffect, useMemo, useRef, useState } = React;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function getAgentPosition(frame, agentId, fallback) {
      if (!frame || !Array.isArray(frame.agents)) return fallback;
      const a = frame.agents.find((x) => x.persona_id === agentId);
      if (!a || !a.position) return fallback;
      return { x: Number(a.position.x || fallback.x), y: Number(a.position.y || fallback.y) };
    }

    function Simulation2D({ data, frameIndex, onFrameChange, playing, setPlaying }) {
      const frames = data.frames || [];
      const current = frames[frameIndex] || {};
      const apartment = data.apartment || {};
      const widthUnits = Number(apartment.width_units || 20);
      const heightUnits = Number(apartment.height_units || 15);

      const cellW = 26;
      const worldW = widthUnits * cellW;
      const worldH = heightUnits * cellW;

      return (
        <div className="h-full flex flex-col">
          <div className="px-4 py-3 border-b bg-white flex items-center justify-between gap-3">
            <div className="text-sm text-slate-700">
              <strong>Tick:</strong> {current.tick ?? 0} · <strong>Time:</strong> {current.time_label || "--:--"}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1.5 text-sm rounded bg-slate-900 text-white"
                onClick={() => setPlaying(!playing)}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <input
                type="range"
                min="0"
                max={Math.max(0, frames.length - 1)}
                value={frameIndex}
                onChange={(e) => onFrameChange(Number(e.target.value || 0))}
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-slate-100">
            <div className="mx-auto my-4 bg-white rounded shadow" style={{ width: worldW + 24 }}>
              <svg width={worldW + 24} height={worldH + 24}>
                <g transform="translate(12,12)">
                  {(apartment.rooms || []).map((room) => (
                    <g key={room.id}>
                      <rect
                        x={room.x * cellW}
                        y={room.y * cellW}
                        width={room.w * cellW}
                        height={room.h * cellW}
                        fill={room.color || "#e2e8f0"}
                        stroke="#64748b"
                        strokeWidth="1"
                        rx="4"
                      />
                      <text
                        x={room.x * cellW + 6}
                        y={room.y * cellW + 16}
                        fontSize="11"
                        fill="#0f172a"
                      >
                        {room.label}
                      </text>
                    </g>
                  ))}

                  {(apartment.hotspots || []).map((h) => (
                    <text
                      key={h.id}
                      x={h.x * cellW}
                      y={h.y * cellW}
                      fontSize="14"
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {h.emoji || "📍"}
                    </text>
                  ))}

                  {(data.personas || []).map((p) => {
                    const fallback = p.start_position || { x: 1, y: 1 };
                    const pos = getAgentPosition(current, p.id, fallback);
                    return (
                      <g key={p.id}>
                        <circle
                          cx={pos.x * cellW}
                          cy={pos.y * cellW}
                          r="8"
                          fill={p.color || "#334155"}
                        />
                        <text
                          x={pos.x * cellW}
                          y={pos.y * cellW - 13}
                          fontSize="11"
                          textAnchor="middle"
                          fill="#0f172a"
                        >
                          {p.emoji || "🙂"} {p.name || p.id}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>
          </div>
        </div>
      );
    }

    function Simulation3D({ data, frameIndex, onFrameChange, playing, setPlaying }) {
      const mountRef = useRef(null);
      const sceneRef = useRef(null);
      const cameraRef = useRef(null);
      const rendererRef = useRef(null);
      const meshesRef = useRef({});

      useEffect(() => {
        if (!mountRef.current) return;

        const width = mountRef.current.clientWidth || 900;
        const height = mountRef.current.clientHeight || 520;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf1f5f9);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(60, width / Math.max(1, height), 0.1, 1000);
        camera.position.set(10, 18, 20);
        camera.lookAt(10, 0, 8);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        rendererRef.current = renderer;
        mountRef.current.appendChild(renderer.domElement);

        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambient);
        const directional = new THREE.DirectionalLight(0xffffff, 0.7);
        directional.position.set(5, 14, 6);
        scene.add(directional);

        const apartment = data.apartment || {};
        (apartment.rooms || []).forEach((room) => {
          const geom = new THREE.BoxGeometry(room.w, 0.1, room.h);
          const mat = new THREE.MeshLambertMaterial({ color: room.color || "#cbd5e1" });
          const floor = new THREE.Mesh(geom, mat);
          floor.position.set(room.x + room.w / 2, 0, room.y + room.h / 2);
          scene.add(floor);
        });

        (data.personas || []).forEach((p) => {
          const geom = new THREE.SphereGeometry(0.35, 24, 24);
          const mat = new THREE.MeshLambertMaterial({ color: p.color || "#334155" });
          const mesh = new THREE.Mesh(geom, mat);
          const start = p.start_position || { x: 1, y: 1 };
          mesh.position.set(Number(start.x || 1), 0.35, Number(start.y || 1));
          scene.add(mesh);
          meshesRef.current[p.id] = mesh;
        });

        let raf = 0;
        const animate = () => {
          raf = requestAnimationFrame(animate);
          renderer.render(scene, camera);
        };
        animate();

        return () => {
          cancelAnimationFrame(raf);
          if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
            mountRef.current.removeChild(renderer.domElement);
          }
          renderer.dispose();
        };
      }, []);

      useEffect(() => {
        const frame = (data.frames || [])[frameIndex];
        if (!frame) return;
        (data.personas || []).forEach((p) => {
          const mesh = meshesRef.current[p.id];
          if (!mesh) return;
          const fallback = p.start_position || { x: 1, y: 1 };
          const pos = getAgentPosition(frame, p.id, fallback);
          mesh.position.set(Number(pos.x || 1), 0.35, Number(pos.y || 1));
        });
      }, [frameIndex, data]);

      const frames = data.frames || [];
      const current = frames[frameIndex] || {};

      return (
        <div className="h-full flex flex-col">
          <div className="px-4 py-3 border-b bg-white flex items-center justify-between gap-3">
            <div className="text-sm text-slate-700">
              <strong>Tick:</strong> {current.tick ?? 0} · <strong>Time:</strong> {current.time_label || "--:--"}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1.5 text-sm rounded bg-slate-900 text-white"
                onClick={() => setPlaying(!playing)}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <input
                type="range"
                min="0"
                max={Math.max(0, frames.length - 1)}
                value={frameIndex}
                onChange={(e) => onFrameChange(Number(e.target.value || 0))}
              />
            </div>
          </div>
          <div ref={mountRef} className="flex-1" />
        </div>
      );
    }

    function App() {
      const data = window.__SIM_DATA__ || {};
      const totalFrames = (data.frames || []).length;
      const [mode, setMode] = useState("2d");
      const [frameIndex, setFrameIndex] = useState(0);
      const [playing, setPlaying] = useState(true);

      useEffect(() => {
        if (!playing || totalFrames <= 1) return;
        const id = setInterval(() => {
          setFrameIndex((prev) => (prev + 1) % totalFrames);
        }, 380);
        return () => clearInterval(id);
      }, [playing, totalFrames]);

      const summary = data.simulation_summary || {};
      const compatibilityPct = Math.round(clamp(Number(summary.compatibility_score || 0), 0, 1) * 100);

      return (
        <div className="h-full flex flex-col">
          <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
            <div className="font-semibold">Domus Visual Simulation</div>
            <div className="text-sm">Compatibility: {compatibilityPct}%</div>
          </div>

          <div className="px-4 py-2 bg-white border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                className={`px-3 py-1.5 rounded text-sm ${mode === "2d" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
                onClick={() => setMode("2d")}
              >
                2D
              </button>
              <button
                className={`px-3 py-1.5 rounded text-sm ${mode === "3d" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
                onClick={() => setMode("3d")}
              >
                3D
              </button>
            </div>
            <div className="text-xs text-slate-600">Frames: {totalFrames}</div>
          </div>

          <div className="flex-1 min-h-0">
            {mode === "2d" ? (
              <Simulation2D
                data={data}
                frameIndex={frameIndex}
                onFrameChange={setFrameIndex}
                playing={playing}
                setPlaying={setPlaying}
              />
            ) : (
              <Simulation3D
                data={data}
                frameIndex={frameIndex}
                onFrameChange={setFrameIndex}
                playing={playing}
                setPlaying={setPlaying}
              />
            )}
          </div>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>
"""

    return html.replace("__SIM_DATA_JSON__", payload_json)
