"use client";

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface DeviceThreeChartProps {
  deviceId: string;
}

interface HoveredNodeInfo {
  name: string;
  details: string;
  status: string;
  metric: string;
}

export default function DeviceThreeChart({ deviceId }: DeviceThreeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredNode, setHoveredNode] = useState<HoveredNodeInfo | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

  
    const width = containerRef.current.clientWidth || 800;
    const height = 550; // Increased height for full page feel

    // Scene
    const scene = new THREE.Scene();
    scene.background = null;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 4, 13);
    camera.lookAt(0, 0, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current,
      antialias: true, 
      alpha: true 
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Group to hold all objects
    const chartGroup = new THREE.Group();
    scene.add(chartGroup);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(0x10b981, 2.5, 50); // Emerald
    pointLight1.position.set(5, 5, 5);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x3b82f6, 2, 50); // Blue
    pointLight2.position.set(-5, -3, 3);
    scene.add(pointLight2);

    const pointLight3 = new THREE.PointLight(0xa855f7, 2, 50); // Purple
    pointLight3.position.set(0, 3, -5);
    scene.add(pointLight3);

    // Nodes creation helper
    const createNode = (id: string, name: string, x: number, y: number, z: number, color: number, size: number) => {
      const geometry = new THREE.SphereGeometry(size, 32, 32);
      const material = new THREE.MeshPhongMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.4,
        shininess: 100,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.userData = { id, name };
      chartGroup.add(mesh);

      // Ring
      const ringGeom = new THREE.RingGeometry(size * 1.3, size * 1.4, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.4
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.position.set(x, y, z);
      ring.rotation.x = Math.PI / 2;
      chartGroup.add(ring);

      return { mesh, ring };
    };

    // Nodes
    const nodeDevice = createNode("device", "Agent Device", -4.5, 0, 0, 0x10b981, 0.75);
    const nodeServer = createNode("server", "Zenvora Core Server", 0, 1.8, 0, 0x3b82f6, 0.95);
    const nodeCloud = createNode("cloud", "Web Cloud Engine", 4.5, -0.5, 0, 0xa855f7, 0.85);

    // Connection lines
    const createConnection = (posA: THREE.Vector3, posB: THREE.Vector3, color: number) => {
      const midPoint = new THREE.Vector3()
        .addVectors(posA, posB)
        .multiplyScalar(0.5);
      midPoint.y += 1.8; // curve height

      const curve = new THREE.QuadraticBezierCurve3(posA, posB, midPoint);
      const curvePoints = curve.getPoints(60);

      const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.35
      });
      const line = new THREE.Line(geometry, material);
      chartGroup.add(line);

      return { curve, line };
    };

    const conn1 = createConnection(nodeDevice.mesh.position, nodeServer.mesh.position, 0x10b981);
    const conn2 = createConnection(nodeServer.mesh.position, nodeCloud.mesh.position, 0x3b82f6);
    const conn3 = createConnection(nodeDevice.mesh.position, nodeCloud.mesh.position, 0xa855f7);

    // Particles flow
    const particlesCount = 40;
    const particleGeometry = new THREE.SphereGeometry(0.12, 8, 8);
    const particles: Array<{
      mesh: THREE.Mesh;
      curve: THREE.QuadraticBezierCurve3;
      progress: number;
      speed: number;
    }> = [];

    const colors = [0x10b981, 0x3b82f6, 0xa855f7];
    const curves = [conn1.curve, conn2.curve, conn3.curve];

    for (let i = 0; i < particlesCount; i++) {
      const curveIndex = i % curves.length;
      const color = colors[curveIndex];
      const curve = curves[curveIndex];

      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.85
      });
      const mesh = new THREE.Mesh(particleGeometry, material);
      chartGroup.add(mesh);

      particles.push({
        mesh,
        curve,
        progress: Math.random(),
        speed: 0.003 + Math.random() * 0.005
      });
    }

    // Grid Floor
    const gridHelper = new THREE.GridHelper(24, 24, 0x3f3f46, 0x27272a);
    gridHelper.position.y = -2;
    chartGroup.add(gridHelper);

    // Interactive Drag Orbit & Hover Raycasting
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
      
      // Update mouse vector for raycasting (normalized device coordinates)
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Handle drag rotation
      if (isDragging) {
        const deltaX = event.clientX - previousMousePosition.x;
        const deltaY = event.clientY - previousMousePosition.y;

        chartGroup.rotation.y += deltaX * 0.007;
        chartGroup.rotation.x += deltaY * 0.007;

        // Clamp vertical rotation to avoid flipping upside down
        chartGroup.rotation.x = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, chartGroup.rotation.x));
        previousMousePosition = { x: event.clientX, y: event.clientY };
      }
    };

    const handlePointerUp = () => {
      isDragging = false;
    };

    // Zoom functionality via mouse wheel
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      camera.position.z += event.deltaY * 0.01;
      camera.position.z = Math.max(5, Math.min(22, camera.position.z));
    };

    const canvasElement = canvasRef.current;
    canvasElement.addEventListener('pointerdown', handlePointerDown);
    canvasElement.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    canvasElement.addEventListener('wheel', handleWheel, { passive: false });

    // Window resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      camera.aspect = newWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, height);
    };
    window.addEventListener('resize', handleResize);

    // Animation loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Auto-rotation of the group if NOT dragging (very slow orbit)
      if (!isDragging) {
        chartGroup.rotation.y += 0.001;
      }

      // Animate rings
      nodeDevice.ring.rotation.z += 0.012;
      nodeServer.ring.rotation.z -= 0.009;
      nodeCloud.ring.rotation.z += 0.007;

      // Pulse nodes scale
      const time = Date.now() * 0.003;
      nodeDevice.mesh.scale.setScalar(1 + Math.sin(time) * 0.04);
      nodeServer.mesh.scale.setScalar(1 + Math.cos(time * 0.8) * 0.03);
      nodeCloud.mesh.scale.setScalar(1 + Math.sin(time * 1.2) * 0.05);

      // Raycaster hover check
      raycaster.setFromCamera(mouse, camera);
      const meshesToIntersect = [nodeDevice.mesh, nodeServer.mesh, nodeCloud.mesh];
      const intersects = raycaster.intersectObjects(meshesToIntersect);

      if (intersects.length > 0) {
        const hitObject = intersects[0].object as THREE.Mesh;
        const nodeId = hitObject.userData.id;
        const nodeName = hitObject.userData.name;

        // Position of intersection in client screen space
        const vector = hitObject.position.clone();
        // project to group coordinate space, then to screen space
        vector.applyMatrix4(chartGroup.matrixWorld);
        vector.project(camera);

        const x = (vector.x * .5 + .5) * width;
        const y = (-(vector.y * .5) + .5) * height;

        setTooltipPos({ x, y });

        // Map correct node metrics
        if (nodeId === "device") {
          setHoveredNode({
            name: nodeName,
            details: `ID: ${deviceId.substring(0, 16)}...`,
            status: "Linked & Streaming",
            metric: "Socket Connection: Active"
          });
        } else if (nodeId === "server") {
          setHoveredNode({
            name: nodeName,
            details: "Express API & WebSocket Gateway Core",
            status: "Online - Port 3000",
            metric: "Latency: < 5ms"
          });
        } else if (nodeId === "cloud") {
          setHoveredNode({
            name: nodeName,
            details: "External Geolocators & IP Lookup APIs",
            status: "Connected",
            metric: "Services: OpenStreetMap / Leaflet"
          });
        }
        document.body.style.cursor = 'pointer';
      } else {
        setHoveredNode(null);
        document.body.style.cursor = 'default';
      }

      // Update particles
      particles.forEach((p) => {
        p.progress += p.speed;
        if (p.progress > 1) p.progress = 0;

        const point = p.curve.getPointAt(p.progress);
        p.mesh.position.copy(point);

        if (p.progress < 0.1) {
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.progress / 0.1;
        } else if (p.progress > 0.9) {
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - p.progress) / 0.1;
        } else {
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
        }
      });

      renderer.render(scene, camera);
    };

    animate();

    // Clean up
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
  }, [deviceId]);

  return (
    <div ref={containerRef} className="relative w-full h-[550px] overflow-hidden select-none bg-transparent">
      
      {/* Visualizer header */}
      <div className="absolute top-6 left-6 z-10 pointer-events-none">
        <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
          <span className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
          </span>
          3D Interactive MDM Topology Map
        </h3>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          DRAG to Orbit / SCROLL to Zoom. HOVER nodes to inspect data details.
        </p>
      </div>

      <div className="absolute bottom-6 left-6 z-10 pointer-events-none flex gap-6 text-[11px] font-mono text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" /> Agent (Device)</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#3b82f6]" /> Server Orchestrator</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#a855f7]" /> Cloud API Nodes</span>
      </div>

      {/* THREE JS CANVAS */}
      <canvas ref={canvasRef} className="w-full h-full cursor-grab active:cursor-grabbing block" />

      {/* Floating Raycaster Tooltip */}
      {hoveredNode && (
        <div 
          className="absolute z-20 pointer-events-none p-3.5 bg-background/95 border border-border/80 rounded-xl shadow-2xl backdrop-blur-md flex flex-col gap-1 w-64 transition-all duration-75"
          style={{ 
            left: `${tooltipPos.x + 15}px`, 
            top: `${tooltipPos.y - 45}px`,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <div className="flex items-center justify-between border-b border-border/50 pb-1.5 mb-1.5">
            <span className="font-bold text-sm text-foreground">{hoveredNode.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-mono font-bold">
              {hoveredNode.status}
            </span>
          </div>
          <span className="text-xs text-muted-foreground leading-normal">{hoveredNode.details}</span>
          <span className="text-[10px] text-blue-400 font-mono mt-1 font-semibold">{hoveredNode.metric}</span>
        </div>
      )}
    </div>
  );
}
