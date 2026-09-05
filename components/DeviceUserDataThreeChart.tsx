"use client";

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface UserDataPoint {
  label: string;
  count: number;
}

interface DeviceUserDataThreeChartProps {
  data: UserDataPoint[];
}

export default function DeviceUserDataThreeChart({ data }: DeviceUserDataThreeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredBar, setHoveredBar] = useState<{ name: string; count: number } | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const width = containerRef.current.clientWidth || 800;
    const height = 550;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 6, 13);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const chartGroup = new THREE.Group();
    scene.add(chartGroup);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x3b82f6, 2.5); // Blue
    dirLight1.position.set(10, 15, 10);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x10b981, 1.8); // Emerald
    dirLight2.position.set(-10, 10, -5);
    scene.add(dirLight2);

    // Create 3D Bars
    const barMeshes: THREE.Mesh[] = [];
    const points = data && data.length > 0 ? data.slice(0, 10) : [
      { label: "Chrome.exe", count: 25 },
      { label: "VSCode.exe", count: 18 },
      { label: "Explorer.exe", count: 12 },
      { label: "Discord.exe", count: 10 },
      { label: "Terminal.exe", count: 8 }
    ];

    const maxCount = Math.max(...points.map(p => p.count), 1);
    const radius = 4.2;
    const barWidth = 0.55;

    points.forEach((point, i) => {
      const angle = (i / points.length) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const barHeight = (point.count / maxCount) * 4.8 + 0.4; // height scale

      const geometry = new THREE.BoxGeometry(barWidth, barHeight, barWidth);
      const color = i % 2 === 0 ? 0x3b82f6 : 0x10b981; // alternate Blue/Emerald
      const material = new THREE.MeshPhongMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.25,
        shininess: 90,
        transparent: true,
        opacity: 0.85
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, -2 + barHeight / 2, z);
      mesh.userData = { label: point.label, count: point.count };
      chartGroup.add(mesh);
      barMeshes.push(mesh);

      // Glowing circular base under each bar
      const baseGeom = new THREE.CylinderGeometry(barWidth * 0.8, barWidth * 0.8, 0.05, 16);
      const baseMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.45
      });
      const baseMesh = new THREE.Mesh(baseGeom, baseMat);
      baseMesh.position.set(x, -2, z);
      chartGroup.add(baseMesh);
    });

    // Tech Grid floor
    const gridHelper = new THREE.GridHelper(22, 22, 0x3f3f46, 0x27272a);
    gridHelper.position.y = -2;
    chartGroup.add(gridHelper);

    // Orbit controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handlePointerDown = (event: PointerEvent) => {
      isDragging = true;
      previousMousePosition = { x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      if (isDragging) {
        const deltaX = event.clientX - previousMousePosition.x;
        const deltaY = event.clientY - previousMousePosition.y;

        chartGroup.rotation.y += deltaX * 0.007;
        chartGroup.rotation.x += deltaY * 0.007;

        chartGroup.rotation.x = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, chartGroup.rotation.x));
        previousMousePosition = { x: event.clientX, y: event.clientY };
      }
    };

    const handlePointerUp = () => {
      isDragging = false;
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      camera.position.z += event.deltaY * 0.012;
      camera.position.z = Math.max(5, Math.min(22, camera.position.z));
    };

    const canvasElement = canvasRef.current;
    canvasElement.addEventListener('pointerdown', handlePointerDown);
    canvasElement.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    canvasElement.addEventListener('wheel', handleWheel, { passive: false });

    const handleResize = () => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      camera.aspect = newWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, height);
    };
    window.addEventListener('resize', handleResize);

    // Animation Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (!isDragging) {
        chartGroup.rotation.y += 0.0025; // Slow rotate
      }

      // Check hover
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(barMeshes);

      if (intersects.length > 0) {
        const hitBar = intersects[0].object as THREE.Mesh;
        
        barMeshes.forEach(mesh => {
          if (mesh === hitBar) {
            mesh.scale.set(1.15, 1, 1.15);
            (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.55;
          } else {
            mesh.scale.set(1, 1, 1);
            (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.25;
          }
        });

        const vector = hitBar.position.clone();
        vector.applyMatrix4(chartGroup.matrixWorld);
        vector.project(camera);

        const x = (vector.x * .5 + .5) * width;
        const y = (-(vector.y * .5) + .5) * height;

        setTooltipPos({ x, y });
        setHoveredBar({
          name: hitBar.userData.label,
          count: hitBar.userData.count
        });
        document.body.style.cursor = 'pointer';
      } else {
        barMeshes.forEach(mesh => {
          mesh.scale.set(1, 1, 1);
          (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.25;
        });
        setHoveredBar(null);
        document.body.style.cursor = 'default';
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      canvasElement.removeEventListener('pointerdown', handlePointerDown);
      canvasElement.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      canvasElement.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', handleResize);
      scene.clear();
      renderer.dispose();
    };
  }, [data]);

  return (
    <div ref={containerRef} className="relative w-full h-[550px] overflow-hidden select-none bg-transparent">
      
      <div className="absolute top-6 left-6 z-10 pointer-events-none">
        <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
          <span className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          3D Process & Domain Usage Analytics
        </h3>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          DRAG to Orbit / SCROLL to Zoom. HOVER bars to view usage metrics.
        </p>
      </div>

      <canvas ref={canvasRef} className="w-full h-full cursor-grab active:cursor-grabbing block" />

      {hoveredBar && (
        <div
          className="absolute z-20 pointer-events-none p-3.5 bg-background/95 border border-border/80 rounded-xl shadow-2xl backdrop-blur-md flex flex-col gap-0.5 w-56 transition-all duration-75 text-xs"
          style={{
            left: `${tooltipPos.x + 15}px`,
            top: `${tooltipPos.y - 45}px`,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <span className="font-bold text-foreground truncate block mb-1 border-b border-border/50 pb-1">{hoveredBar.name}</span>
          <div className="flex items-center justify-between text-[11px] font-mono mt-1">
            <span className="text-muted-foreground">Action Count:</span>
            <span className="text-emerald-500 font-bold">{hoveredBar.count} logs</span>
          </div>
        </div>
      )}
    </div>
  );
}
