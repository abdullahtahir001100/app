"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CustomSlider } from "@/components/custom-slider";
import { Camera, Video, Download, RefreshCw, Square, Cpu, Trash2, Image as ImageIcon, Film, Power, Radar } from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Select from "react-select";
import { useGateway } from "@/hooks/use-gateway";
import { gatewayClient } from "@/lib/gateway-client";
import type { DeviceOption } from "@/lib/gateway-client";
import { unwrapDeviceBinaryFrame } from "@/lib/binary-frame";
import { MediaGatewayClient } from "@/lib/media-gateway-client";
import {
  dispatchMediaTransportPreference,
  getPreferredMediaTransport,
  type MediaTransport,
} from "@/lib/media-transport";

function b64ToBlob(b64: string, mimeType: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

type CameraTelemetry = {
  resolution: string;
  fps: string;
  bitrate: string;
  latency: string;
  status: string;
};

type DetectedCamera = {
  id: string;
  index: number;
  label: string;
  status: string;
  resolution: string;
  fps: string;
};

export default function CameraPage() {
  const searchParams = useSearchParams();
  const requestedDevice = searchParams.get("device") || "";
  const {
    isConnected,
    devices: deviceOptions,
    dispatch: gatewayDispatch,
    refreshDevices,
    subscribe,
    resolveTarget,
    isDeviceOnline,
    ensureConnected,
  } = useGateway();

  const [selectedDevice, setSelectedDevice] = useState("");
  const agentOnline = Boolean(selectedDevice) && isDeviceOnline(selectedDevice);
  const canControl = isConnected && agentOnline;
  const [commandStatus, setCommandStatus] = useState("Waiting for live agent...");
  const [mediaTransport, setMediaTransport] = useState<MediaTransport>("wss");
  const selectedDeviceRef = useRef("");
  const activeCameraRef = useRef("");
  const deviceOptionsRef = useRef<DeviceOption[]>([]);
  const sliderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeCamera, setActiveCamera] = useState("");
  const [detectedCameras, setDetectedCameras] = useState<DetectedCamera[]>([]);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [zoom, setZoom] = useState(1.0);
  const [flashEnabled, setFlashEnabled] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveImgRef = useRef<HTMLImageElement>(null);
  const rgbCanvasRef = useRef<HTMLCanvasElement>(null);
  const filterWrapRef = useRef<HTMLDivElement>(null);
  const streamStageRef = useRef<HTMLDivElement>(null);
  const brightnessRef = useRef(100);
  const contrastRef = useRef(100);
  const zoomRef = useRef(1.0);
  const lastBlobUrlRef = useRef<string | null>(null);
  const lastFrameBlobRef = useRef<Blob | null>(null);
  const framesReceivedRef = useRef(0);
  const recordSyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);

  const [hasLiveFrame, setHasLiveFrame] = useState(false);
  const [liveFrameCount, setLiveFrameCount] = useState(0);
  const [capturedPhotos, setCapturedPhotos] = useState<Array<{ id: string; url: string; time: string }>>([]);
  const [recordedClips, setRecordedClips] = useState<Array<{ id: string; url: string; time: string; duration: string }>>([]);

  const [telemetry, setTelemetry] = useState<CameraTelemetry>({
    resolution: "---",
    fps: "---",
    bitrate: "---",
    latency: "Connecting...",
    status: "STANDBY"
  });

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const selectedDeviceOption = deviceOptions.find((opt) => opt.value === selectedDevice) || null;
  const activeCameraMeta = detectedCameras.find((cam) => cam.id === activeCamera) || null;

  const linkState = useMemo<"online" | "connecting" | "offline">(() => {
    if (hasLiveFrame || agentOnline) return "online";
    if (!isConnected || isCameraOn || !selectedDevice || deviceOptions.length === 0) {
      return "connecting";
    }
    return "offline";
  }, [
    hasLiveFrame,
    agentOnline,
    isConnected,
    isCameraOn,
    selectedDevice,
    deviceOptions.length,
  ]);

  const linkDotClass =
    linkState === "online"
      ? "bg-emerald-500 animate-pulse"
      : linkState === "connecting"
        ? "bg-amber-400 animate-pulse"
        : "bg-rose-500";

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

  useEffect(() => {
    setMediaTransport(getPreferredMediaTransport());
  }, []);

  useEffect(() => {
    activeCameraRef.current = activeCamera;
  }, [activeCamera]);

  useEffect(() => {
    if (!isConnected) return;
    const target =
      selectedDeviceRef.current ||
      gatewayClient.getCameraStreamingAgentId() ||
      deviceOptions[0]?.value;
    if (!target) return;
    selectedDeviceRef.current = target;
    setSelectedDevice((prev) => prev || target);
    gatewayDispatch("FETCH_TELEMETRY", { include_frame: false }, target);
  }, [isConnected, deviceOptions.length, gatewayDispatch]);

  useEffect(() => {
    deviceOptionsRef.current = deviceOptions;
    if (deviceOptions.length === 0) return;
    const knownIds = deviceOptions.map((d) => d.value);
    const fromQuery =
      requestedDevice && knownIds.includes(requestedDevice) ? requestedDevice : "";
    if (fromQuery && selectedDeviceRef.current !== fromQuery) {
      selectedDeviceRef.current = fromQuery;
      setSelectedDevice(fromQuery);
      setCommandStatus(`Selected agent: ${fromQuery}`);
      return;
    }
    if (!selectedDeviceRef.current || !knownIds.includes(selectedDeviceRef.current)) {
      const online = deviceOptions.find((d) => d.status === "online");
      const pick = online || deviceOptions[0];
      selectedDeviceRef.current = pick.value;
      setSelectedDevice(pick.value);
      setCommandStatus(`Live agent found: ${pick.value}`);
    }
  }, [deviceOptions, requestedDevice]);

  const applyGpuFilters = () => {
    const wrap = filterWrapRef.current;
    if (!wrap) return;

    const b = brightnessRef.current;
    const c = contrastRef.current;
    const z = zoomRef.current;

    if (b === 100 && c === 100 && z === 1) {
      wrap.style.filter = "none";
      wrap.style.transform = "none";
      return;
    }

    const brightnessValue = b / 100;
    const contrastValue = c / 100;
    wrap.style.filter = `brightness(${brightnessValue}) contrast(${contrastValue})`;
    wrap.style.transform = `scale(${z})`;
    wrap.style.transformOrigin = "center center";
  };

  const uploadMediaToVault = async (blob: Blob, type: "image" | "video") => {
    const deviceId = selectedDeviceRef.current;
    if (!deviceId) {
      throw new Error("Select a live agent device before saving to cloud vault.");
    }

    const formData = new FormData();
    formData.append("file", blob, type === "image" ? `snapshot_${Date.now()}.jpg` : `recording_${Date.now()}.webm`);
    formData.append("type", type);
    formData.append("deviceId", deviceId);
    formData.append("source", "camera");

    const response = await fetch("/api/media/upload", {
      method: "POST",
      body: formData
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Database media save failed.");
    }

    await loadServerGallery(deviceId);
    return result;
  };

  const saveSnapshotToGallery = async (blob: Blob) => {
    setCommandStatus("Saving snapshot to database vault...");

    try {
      await uploadMediaToVault(blob, "image");
      setCommandStatus("Snapshot saved to database vault.");
    } catch (error) {
      console.error("Snapshot upload failed:", error);
      setCommandStatus(
        error instanceof Error ? error.message : "Snapshot save failed — check agent and database."
      );
    }
  };

  const loadServerGallery = async (deviceId?: string) => {
    const targetId = deviceId || selectedDeviceRef.current;
    if (!targetId) return;

    try {
      const response = await fetch(
        `/api/media/list?deviceId=${encodeURIComponent(targetId)}&source=camera`
      );
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return;

      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.items)) return;

      const serverPhotos = data.items
        .filter((item: { type: string; id?: string }) => item.type === "image" && item.id && !String(item.id).includes("/"))
        .map((item: { id: string; url: string; timestamp?: string }) => ({
          id: String(item.id),
          url: item.url,
          time: item.timestamp
            ? new Date(item.timestamp).toLocaleTimeString()
            : new Date().toLocaleTimeString(),
        }));

      const serverClips = data.items
        .filter((item: { type: string; id?: string }) => item.type === "video" && item.id && !String(item.id).includes("/"))
        .map((item: { id: string; url: string; timestamp?: string }) => ({
          url: item.url,
          time: item.timestamp
            ? new Date(item.timestamp).toLocaleTimeString()
            : new Date().toLocaleTimeString(),
          duration: "00:00",
        }));

      setCapturedPhotos(serverPhotos);
      setRecordedClips(serverClips);
    } catch (error) {
      console.warn("Failed to load server gallery:", error);
    }
  };

  useEffect(() => {
    if (!isConnected) return;
    const target = selectedDeviceRef.current || deviceOptions[0]?.value;
    if (target) void loadServerGallery(target);
  }, [isConnected, deviceOptions.length]);

  useEffect(() => {
    if (!selectedDevice) return;
    void loadServerGallery(selectedDevice);
  }, [selectedDevice]);

  const resetLivePreview = () => {
    framesReceivedRef.current = 0;
    lastFrameBlobRef.current = null;
    setHasLiveFrame(false);
    setLiveFrameCount(0);
    if (lastBlobUrlRef.current) {
      URL.revokeObjectURL(lastBlobUrlRef.current);
      lastBlobUrlRef.current = null;
    }
    if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const showLiveFrame = (blob: Blob, saveSnapshot = false) => {
    if (blob.size < 100) return;

    lastFrameBlobRef.current = blob;
    const url = URL.createObjectURL(blob);
    if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current);
    lastBlobUrlRef.current = url;

    if (liveImgRef.current) {
      liveImgRef.current.src = url;
    }

    framesReceivedRef.current += 1;
    setHasLiveFrame(true);
    setLiveFrameCount(framesReceivedRef.current);
    applyGpuFilters();

    if (framesReceivedRef.current === 1) {
      setCommandStatus("Live camera preview active.");
    }

    if (saveSnapshot) {
      void saveSnapshotToGallery(blob);
    }
  };

  const rgbToJpegBlob = (
    rgb: Uint8Array,
    width: number,
    height: number
  ): Promise<Blob | null> => {
    const canvas = rgbCanvasRef.current ?? document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);

    const imageData = ctx.createImageData(width, height);
    const out = imageData.data;
    const pixelCount = width * height;
    for (let i = 0; i < pixelCount; i += 1) {
      const src = i * 3;
      const dst = i * 4;
      out[dst] = rgb[src];
      out[dst + 1] = rgb[src + 1];
      out[dst + 2] = rgb[src + 2];
      out[dst + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob((jpeg) => resolve(jpeg), "image/jpeg", 0.88);
    });
  };

  const processBinaryPayload = async (payload: ArrayBuffer | Blob, saveSnapshot = false) => {
    const buffer = payload instanceof Blob ? await payload.arrayBuffer() : payload;
    const raw = new Uint8Array(buffer);
    if (raw.length < 2) return;

    const { deviceId, frame: bytes } = unwrapDeviceBinaryFrame(raw);
    const selected = selectedDeviceRef.current || "";
    if (deviceId && selected && deviceId !== selected) return;
    if (bytes.length < 2) return;

    const frameType = bytes[0];

    if (frameType === 0x01 || frameType === 0x02) {
      const jpegBlob = new Blob([bytes.subarray(1).slice()], {
        type: "image/jpeg",
      });
      showLiveFrame(jpegBlob, saveSnapshot || frameType === 0x02);
      return;
    }

    if (frameType === 0x03 && bytes.length >= 6) {
      const width = (bytes[1] << 8) | bytes[2];
      const height = (bytes[3] << 8) | bytes[4];
      const rgb = bytes.slice(5);
      const expected = width * height * 3;
      if (width < 16 || height < 16 || rgb.length < expected) return;

      const jpegBlob = await rgbToJpegBlob(rgb.slice(0, expected), width, height);
      if (jpegBlob) showLiveFrame(jpegBlob, saveSnapshot);
    }
  };

  // ========================================================
  // MODULE 1: WEBSOCKET LIFECYCLE GATEWAY
  // ========================================================
  const processBinaryRef = useRef(processBinaryPayload);
  processBinaryRef.current = processBinaryPayload;

  useEffect(() => {
    const deviceId = selectedDevice || "";
    if (!deviceId || !isCameraOn) return;
    const client = new MediaGatewayClient();
    const unsub = client.subscribe((data) => {
      void processBinaryRef.current(data).catch((err) => {
        console.error("Media WS frame decode failed:", err);
        setCommandStatus("Media frame received but decode failed.");
      });
    });
    void client.connect(deviceId, "camera").catch(() => {
      setCommandStatus("Media ticket failed — check /api/auth/ws-ticket and /ws/media.");
    });
    return () => {
      unsub();
      client.disconnect();
    };
  }, [selectedDevice, isCameraOn]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "binary") {
        void processBinaryRef.current(event.data).catch((err) => {
          console.error("Binary stream decode failed:", err);
          setCommandStatus("Binary frame received but decode failed.");
        });
        return;
      }

      if (event.type !== "json") return;

      const data = event.packet;

      const isStreamTick = data.action === "STREAM_TICK";

      if (data.type === "sys_ack" && typeof data.status === "string" && !isStreamTick) {
        const statusText = data.status as string;
        if (
          !statusText.includes("dispatched") &&
          !statusText.includes("piped downstream") &&
          !statusText.includes("ready")
        ) {
          setCommandStatus(String(data.message || statusText));
        }
      }

      if (data.type === "sys_error" && typeof data.message === "string") {
        setCommandStatus(data.message);
      }

      if ((data.type === "camera_telemetry_stream" || data.type === "sys_ack") && !isStreamTick) {
        const sender = typeof data.senderAgentId === "string" ? data.senderAgentId : "";
        if (sender && selectedDeviceRef.current && sender !== selectedDeviceRef.current) {
          return;
        }
        const metrics = (data.metrics || data.hardware_metrics) as Record<string, unknown> | undefined;
        if (metrics) {
          if (Array.isArray(metrics.available_cameras)) {
            setDetectedCameras(metrics.available_cameras as DetectedCamera[]);
            if (!activeCameraRef.current && metrics.available_cameras.length > 0) {
              setActiveCamera((metrics.available_cameras[0] as DetectedCamera).id);
            }
          }

          if (metrics.lens_active) {
            setActiveCamera(String(metrics.lens_active));
          }

          // Never auto-toggle local ON from telemetry — only user Start/Stop buttons.

          setTelemetry({
            resolution: (metrics.resolution as string) || "N/A",
            fps: (metrics.fps as string) || "N/A",
            bitrate: (metrics.bitrate as string) || "N/A",
            latency: `${metrics.latency_ms || 0}ms`,
            status: (data.status as string) || (metrics.driver_status as string) || "READY",
          });

          if (
            metrics.camera_blocked ||
            data.camera_blocked ||
            data.status === "CAMERA_BLOCKED"
          ) {
            setIsCameraOn(false);
            resetLivePreview();
            try {
              sessionStorage.setItem("zenvora_camera_streaming", "0");
            } catch {
              // ignore storage errors
            }
            setCommandStatus(
              String(
                metrics.camera_status_message ||
                  data.message ||
                  "Camera is in use by another app on this PC. Close Camera app and try again."
              )
            );
          } else if (data.action === "STREAM_LOST") {
            // Transient stream gap (motion lag / reconnect) — keep UI ON; agent will resume frames.
            setCommandStatus(
              String(data.message || "Stream interrupted — waiting for frames…")
            );
          } else if (data.has_binary_frame && framesReceivedRef.current === 0) {
            setCommandStatus("Agent sent frame metadata. Waiting for binary paint...");
          } else if (metrics.streaming_active && framesReceivedRef.current > 0) {
            setCommandStatus(`Live stream active (${framesReceivedRef.current} frames).`);
          } else if (metrics.streaming_active) {
            setCommandStatus("Stream started. Waiting for first binary frame...");
          } else if (
            (data.last_action === "STOP_STREAM" || data.action === "STOP_STREAM") &&
            data.message
          ) {
            setIsCameraOn(false);
            resetLivePreview();
            setCommandStatus(String(data.message));
          } else if (data.last_action === "START_STREAM" || data.action === "START_STREAM") {
            if (typeof data.message === "string" && data.message) {
              setCommandStatus(data.message);
            }
            // Keep local ON intent; agent may briefly report streaming_active=false while opening the lens.
          }

          setFlashEnabled(metrics.gpio_flash_pin === "HIGH");
          if (typeof metrics.recording_active === "boolean") setIsRecording(metrics.recording_active);
          if (metrics.brightness !== undefined) {
            brightnessRef.current = metrics.brightness as number;
            setBrightness(metrics.brightness as number);
          }
          if (metrics.contrast !== undefined) {
            contrastRef.current = metrics.contrast as number;
            setContrast(metrics.contrast as number);
          }
          if (metrics.zoom !== undefined) {
            zoomRef.current = metrics.zoom as number;
            setZoom(metrics.zoom as number);
          }

          applyGpuFilters();

          if (typeof metrics.live_frame_b64 === "string" && metrics.live_frame_b64.length > 100) {
            try {
              showLiveFrame(b64ToBlob(metrics.live_frame_b64, "image/jpeg"));
            } catch (error) {
              console.warn("live_frame_b64 decode failed:", error);
            }
          }
        }
      }

      if (data.type === "media_buffer_payload") {
        void loadServerGallery(selectedDeviceRef.current);
      }
    });
  }, [subscribe]);

  useEffect(() => {
    return () => {
      if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current);
    };
  }, []);

  // ========================================================
  // MODULE 2: COMMAND DISPATCH INTERPOLATOR
  // ========================================================
  const dispatchControl = (
    actionToken: string,
    customPayload: Record<string, unknown>,
    targetOverride?: string,
    silent = false
  ) => {
    const targetDeviceId =
      targetOverride || selectedDeviceRef.current || resolveTarget(deviceOptions[0]?.value);
    if (!targetDeviceId) {
      if (!silent) setCommandStatus("Select a live camera node before sending controls.");
      return;
    }

    const result = gatewayDispatch(actionToken, customPayload, targetDeviceId);
    if (!result.ok) {
      if (!silent) setCommandStatus("Socket offline. Start the server and Rust agent first.");
      return;
    }

    if (!selectedDeviceRef.current) {
      selectedDeviceRef.current = targetDeviceId;
      setSelectedDevice(targetDeviceId);
    }

    if (!silent) setCommandStatus(`Sent ${actionToken} to ${targetDeviceId}`);
  };

  const handleCameraFlip = (camera: DetectedCamera) => {
    setActiveCamera(camera.id);
    activeCameraRef.current = camera.id;
    dispatchControl("SWITCH_CAMERA", {
      camera: camera.id,
      camera_index: camera.index
    });

    if (isCameraOn) {
      resetLivePreview();
      setTimeout(() => {
        dispatchControl("START_STREAM", {}, undefined, true);
      }, 300);
    }
  };

  const handleSliderOverdrive = (paramType: "BRIGHTNESS" | "CONTRAST" | "ZOOM", incomingValue: number) => {
    if (paramType === "BRIGHTNESS") {
      brightnessRef.current = incomingValue;
      setBrightness(incomingValue);
    }
    if (paramType === "CONTRAST") {
      contrastRef.current = incomingValue;
      setContrast(incomingValue);
    }
    if (paramType === "ZOOM") {
      zoomRef.current = incomingValue;
      setZoom(incomingValue);
    }

    applyGpuFilters();

    if (paramType === "ZOOM") return;

    if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    sliderTimerRef.current = setTimeout(() => {
      dispatchControl(
        "SET_HARDWARE_PARAMETER",
        {
          param: paramType,
          value: incomingValue
        },
        undefined,
        true
      );
    }, 350);
  };

  // Instant download utility for Cloudinary or local blob URLs
  const downloadAsset = (assetUrl: string, fileName: string) => {
    const downloadLink = document.createElement("a");
    downloadLink.href = assetUrl;
    downloadLink.download = fileName;
    downloadLink.target = "_blank";
    downloadLink.rel = "noopener noreferrer";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  const handleToggleRecording = async () => {
    const canvas = canvasRef.current;
    const img = liveImgRef.current;

    if (!isRecording) {
      if (!hasLiveFrame || !canvas || !img || img.naturalWidth === 0) {
        setCommandStatus("Wait for live camera preview before recording.");
        return;
      }

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      recordSyncTimerRef.current = setInterval(() => {
        const liveImg = liveImgRef.current;
        if (!liveImg || liveImg.naturalWidth === 0) return;
        canvas.width = liveImg.naturalWidth;
        canvas.height = liveImg.naturalHeight;
        ctx.drawImage(liveImg, 0, 0, canvas.width, canvas.height);
      }, 66);

      const stream = canvas.captureStream(15);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recordedChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        if (recordSyncTimerRef.current) {
          clearInterval(recordSyncTimerRef.current);
          recordSyncTimerRef.current = null;
        }

        const clipBlob = new Blob(recordedChunksRef.current, { type: mimeType });
        const elapsedSeconds = recordingStartedAtRef.current
          ? Math.max(1, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000))
          : recordingTime;
        const duration = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

        setCommandStatus("Recording finished. Saving to database vault...");

        try {
          await uploadMediaToVault(clipBlob, "video");
          setCommandStatus(`Recording saved to database vault (${duration}).`);
        } catch (error) {
          console.error("Recording upload failed:", error);
          setCommandStatus(
            error instanceof Error ? error.message : "Recording save failed — check agent and database."
          );
        }
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      setIsRecording(true);
      dispatchControl("START_RECORDING", {
        camera: activeCamera,
        config: { brightness, contrast, zoom }
      });
      return;
    }

    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    dispatchControl("STOP_RECORDING", {
      camera: activeCamera,
      config: { brightness, contrast, zoom }
    });
  };

  const handleCapturePhoto = async () => {
    const blob = lastFrameBlobRef.current;
    if (blob && blob.size > 100) {
      await saveSnapshotToGallery(blob);
    } else {
      setCommandStatus("No live frame yet — wait for preview, then capture.");
    }

    dispatchControl("CAPTURE_SNAPSHOT", {
      camera: activeCamera,
      flash: flashEnabled
    });
  };

  const toggleFlashEmitter = () => {
    const nextState = !flashEnabled;
    setFlashEnabled(nextState);
    dispatchControl("SET_FLASH_STATE", { enabled: nextState });
  };

  const startLiveStream = (targetOverride?: string) => {
    const deviceId = targetOverride || selectedDeviceRef.current;
    if (!deviceId) {
      setCommandStatus("Select a live agent device first.");
      return;
    }

    resetLivePreview();
    setIsCameraOn(true);
    try {
      sessionStorage.setItem("zenvora_camera_streaming", "1");
    } catch {
      // ignore storage errors
    }
    dispatchControl("START_STREAM", {}, deviceId, true);
    void loadServerGallery(deviceId);
    setCommandStatus(`Camera turning on for ${deviceId}...`);
  };

  const stopLiveStream = () => {
    const target = selectedDeviceRef.current || deviceOptions[0]?.value;
    if (!target) {
      setCommandStatus("Select a live agent device first.");
      return;
    }
    dispatchControl("STOP_STREAM", {}, target, true);
    resetLivePreview();
    setIsCameraOn(false);
    try {
      sessionStorage.setItem("zenvora_camera_streaming", "0");
    } catch {
      // ignore storage errors
    }
    setCommandStatus("Camera turned off.");
  };

  // Stop camera when leaving page / closing tab.
  useEffect(() => {
    const stopOnUnload = () => {
      try {
        if (sessionStorage.getItem("zenvora_camera_streaming") !== "1") return;
        const target = selectedDeviceRef.current || "";
        if (target) {
          gatewayClient.dispatch("STOP_STREAM", target, {});
        }
        sessionStorage.setItem("zenvora_camera_streaming", "0");
      } catch {
        // ignore
      }
    };
    window.addEventListener("pagehide", stopOnUnload);
    window.addEventListener("beforeunload", stopOnUnload);
    return () => {
      window.removeEventListener("pagehide", stopOnUnload);
      window.removeEventListener("beforeunload", stopOnUnload);
      stopOnUnload();
    };
  }, []);

  const probeHardware = () => {
    const deviceId = selectedDeviceRef.current;
    if (!deviceId) {
      setCommandStatus("Select a live agent device first.");
      return;
    }

    setDetectedCameras([]);
    setActiveCamera("");
    dispatchControl("PROBE_HARDWARE", {}, deviceId);
    dispatchControl("LIST_CAMERAS", {}, deviceId);
    setCommandStatus("Scanning camera hardware on agent...");
  };

  const fetchLatestTelemetry = (targetOverride?: string, includeFrame = false) => {
    dispatchControl(
      "FETCH_TELEMETRY",
      { camera: activeCameraRef.current, include_frame: includeFrame },
      targetOverride,
      includeFrame
    );
  };

  const refreshCameraInventory = (targetOverride?: string) => {
    dispatchControl("LIST_CAMERAS", {}, targetOverride);
  };

  const clearGalleryItem = async (id: string, type: "photo" | "video") => {
    if (!id || id.includes("/")) {
      setCommandStatus("Invalid media id — refresh gallery from database.");
      return;
    }
    try {
      const response = await fetch(`/api/media/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Delete failed");
      }
      if (type === "photo") {
        setCapturedPhotos((prev) => prev.filter((item) => item.id !== id));
      } else {
        setRecordedClips((prev) => prev.filter((item) => item.id !== id));
      }
      setCommandStatus("Moved to trash. Restore from File Manager → Trash.");
    } catch (error) {
      console.error("Gallery delete failed:", error);
      setCommandStatus(error instanceof Error ? error.message : "Could not delete — refresh and try again.");
    }
  };

  // --- RECORDING ENGINE TIMER TICK ---
  useEffect(() => {
    let internalClock: ReturnType<typeof setInterval> | undefined;
    if (isRecording) {
      internalClock = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordingTime(0);
    }
    return () => {
      if (internalClock) clearInterval(internalClock);
    };
  }, [isRecording]);

  useEffect(() => {
    const stage = streamStageRef.current;
    if (!stage) return;

    const observer = new ResizeObserver(() => {
      applyGpuFilters();
    });

    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="flex h-screen bg-background">
      <canvas ref={rgbCanvasRef} className="hidden" aria-hidden />
      <AppSidebar />

      <main className="flex-1 sidebar-aware-main overflow-auto">
        <div className="p-6 lg:p-12">
          
          {/* Header */}
          <div className="mb-8 flex justify-between items-start">
            <div>
              <h1 className="text-4xl lg:text-5xl font-display tracking-tight mb-2 flex items-center gap-3">
                Camera Access
                <span className={`w-3 h-3 rounded-full ${linkDotClass}`} />
              </h1>
              <p className="text-muted-foreground">Control every detected local camera from the Rust agent in real time</p>
            </div>
            <Button variant="outline" size="icon" onClick={() => fetchLatestTelemetry()} disabled={!canControl} className="border-border hover:bg-accent/10">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          {/* Device selector */}
          <div className="mb-8 flex gap-4">
            <div className="w-full relative z-50">
                <Select<DeviceOption, false>
                instanceId="camera-selection-dropdown"
                value={selectedDeviceOption}
                onChange={(option) => {
                  if (!option) return;
                  const nextId = option.value;
                  if (nextId === selectedDeviceRef.current) return;
                  setSelectedDevice(nextId);
                  selectedDeviceRef.current = nextId;
                  resetLivePreview();
                  setDetectedCameras([]);
                  setActiveCamera("");
                  const agentStillStreaming =
                    gatewayClient.isCameraStreaming() &&
                    gatewayClient.getCameraStreamingAgentId() === nextId;
                  if (!agentStillStreaming) {
                    setIsCameraOn(false);
                  }
                }}
                options={deviceOptions}
                className="flex-1"
                classNamePrefix="react-select"
                placeholder={agentOnline ? "Select live Rust camera agent..." : isConnected ? "Waiting for online agent..." : "Connecting to server..."}
                isDisabled={deviceOptions.length === 0}
              />
            </div>
          </div>

          <div className="mb-8 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[12rem]">{commandStatus}</span>
            {(!hasLiveFrame || !agentOnline || commandStatus.toLowerCase().includes("fail") || commandStatus.toLowerCase().includes("offline") || commandStatus.toLowerCase().includes("ticket")) && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 text-xs"
                disabled={!selectedDevice}
                onClick={() => {
                  const next: MediaTransport = mediaTransport === "wss" ? "tcp" : "wss";
                  setMediaTransport(next);
                  const ok = dispatchMediaTransportPreference(gatewayDispatch, next, selectedDevice);
                  setCommandStatus(
                    ok
                      ? `Switched media transport to ${next.toUpperCase()} (manual).`
                      : `Saved ${next.toUpperCase()} preference — agent offline / not pushed.`
                  );
                }}
              >
                Switch to {mediaTransport === "wss" ? "TCP" : "WSS"}
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 mb-8">
            <div className="xl:col-span-8 flex flex-col gap-6">
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={probeHardware}
                  disabled={!canControl}
                  variant="outline"
                  className="gap-2 border-border hover:bg-accent/10"
                >
                  <Radar className="w-4 h-4" /> Scan Cameras
                </Button>
                <Button
                  onClick={() => startLiveStream()}
                  disabled={!canControl || isCameraOn}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Power className="w-4 h-4" /> Turn Camera On
                </Button>
                <Button
                  onClick={stopLiveStream}
                  disabled={!canControl || !isCameraOn}
                  variant="outline"
                  className="gap-2 border-border hover:bg-accent/10"
                >
                  <Power className="w-4 h-4" /> Turn Camera Off
                </Button>
              </div>

          {/* Camera Selection Grid */}
          {detectedCameras.length === 0 ? (
            <Card className="border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
              No cameras scanned yet. Select your agent, click <strong>Scan Cameras</strong>, then turn the camera on.
            </Card>
          ) : (
            <div className={`grid gap-4 ${detectedCameras.length <= 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"}`}>
              {detectedCameras.map((cam) => (
                <button
                  key={cam.id}
                  onClick={() => handleCameraFlip(cam)}
                  disabled={!canControl}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    activeCamera === cam.id ? "border-foreground bg-accent/10" : "border-border bg-card hover:border-foreground/50"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{cam.label}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{cam.resolution}</p>
                    </div>
                    <Camera className="w-4 h-4 shrink-0" />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{cam.fps}</span>
                    <span className={`rounded-full px-2 py-0.5 ${cam.status === "ACTIVE" ? "bg-emerald-500/15 text-emerald-600" : "bg-accent/20"}`}>
                      {cam.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Full Screen Live Camera Stage */}
          <div
            ref={streamStageRef}
            className="relative h-[62vh] min-h-[420px] w-full overflow-hidden rounded-2xl border border-border bg-black shadow-2xl"
          >
            <canvas ref={rgbCanvasRef} className="hidden" aria-hidden />
            <canvas ref={canvasRef} className="hidden" aria-hidden />

            <div
              ref={filterWrapRef}
              className="absolute inset-0 z-10 flex h-full w-full items-center justify-center overflow-hidden"
              style={{ willChange: "transform, filter" }}
            >
              <img
                ref={liveImgRef}
                alt="Live camera feed"
                className="max-h-full max-w-full object-contain transition-opacity duration-200"
                style={{ opacity: hasLiveFrame ? 1 : 0 }}
              />
            </div>

            {!hasLiveFrame && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 to-black p-6 text-center">
                <Camera className="w-16 h-16 mb-4 text-white/30 animate-pulse" />
                <p className="text-white/70 mb-1">Camera is off — click Turn Camera On to start preview</p>
                <p className="text-xs text-white/50 bg-white/10 px-3 py-1 rounded-full flex items-center gap-2 mt-2">
                  <Cpu className="w-3 h-3" /> Node: {selectedDevice || "No Device Selected"} &bull; Camera: {activeCameraMeta?.label || "Waiting for inventory"} &bull; Frames: {liveFrameCount}
                </p>
              </div>
            )}

            {hasLiveFrame && (
              <div className="absolute top-4 right-4 z-30 rounded-full bg-red-600/90 px-3 py-1 text-xs font-mono font-bold text-white">
                LIVE &bull; {liveFrameCount}
              </div>
            )}

            {isRecording && (
              <div className="absolute top-4 left-4 z-30 flex items-center gap-2 bg-red-600/90 px-3 py-2 rounded-full shadow-lg backdrop-blur-sm">
                <span className="w-2.5 h-2.5 bg-white rounded-full animate-ping" />
                <span className="text-white text-xs font-mono font-bold">REC RUNNING</span>
                <span className="text-white text-xs font-mono bg-black/30 px-2 py-0.5 rounded">
                  {String(Math.floor(recordingTime / 60)).padStart(2, "0")}:{String(recordingTime % 60).padStart(2, "0")}
                </span>
              </div>
            )}

            <div className="absolute bottom-4 left-4 z-30 rounded-full bg-black/60 px-3 py-1 text-xs font-mono text-white backdrop-blur-sm">
              {telemetry.resolution} &bull; {telemetry.fps} &bull; {telemetry.latency}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleToggleRecording}
              disabled={!canControl || !isCameraOn}
              className={`gap-2 transition-all font-medium ${isRecording ? "bg-red-600 hover:bg-red-700 text-white" : "bg-foreground hover:bg-foreground/90 text-background"}`}
            >
              {isRecording ? <><Square className="w-4 h-4" /> Stop Recording</> : <><Video className="w-4 h-4" /> Start Recording</>}
            </Button>

            <Button onClick={handleCapturePhoto} disabled={!canControl || !isCameraOn} variant="outline" className="border-border hover:bg-accent/10 gap-2">
              <Camera className="w-4 h-4" /> Capture Snapshot
            </Button>

            <Button variant="outline" disabled={!canControl} onClick={() => loadServerGallery()} className="border-border hover:bg-accent/10 gap-2">
              <Download className="w-4 h-4" /> Refresh Gallery
            </Button>
          </div>
            </div>

            <div className="xl:col-span-4 grid gap-4 content-start">
              <Card className="p-6 border border-border bg-card">
                <h3 className="font-semibold mb-4 text-foreground flex items-center justify-between">
                  Hardware Metrics
                  <span className="text-xs font-mono font-normal bg-accent/20 text-muted-foreground px-2 py-0.5 rounded">{telemetry.status}</span>
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="border-b border-border/40 pb-2">
                    <p className="text-muted-foreground text-xs mb-0.5">Dynamic Lens Resolution</p>
                    <p className="font-mono text-base font-semibold">{telemetry.resolution}</p>
                  </div>
                  <div className="border-b border-border/40 pb-2">
                    <p className="text-muted-foreground text-xs mb-0.5">Driver Framerate Profiler</p>
                    <p className="font-mono text-base font-semibold">{telemetry.fps}</p>
                  </div>
                  <div className="border-b border-border/40 pb-2">
                    <p className="text-muted-foreground text-xs mb-0.5">Stream Network Bitrate</p>
                    <p className="font-mono text-base font-semibold">{telemetry.bitrate}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">WAN/LAN Execution Latency</p>
                    <p className="font-mono text-base font-semibold text-emerald-500">{telemetry.latency}</p>
                  </div>
                </div>
              </Card>

              {/* Sliders Layer */}
              <Card className="p-6 border border-border bg-card">
                <h3 className="font-semibold mb-4">Driver Modifiers Overrides</h3>
                <div className="space-y-6">
                  <CustomSlider label="Brightness" min={0} max={100} value={brightness} showValue unit="%" onChange={(val) => handleSliderOverdrive("BRIGHTNESS", val)} />
                  <CustomSlider label="Contrast" min={0} max={100} value={contrast} showValue unit="%" onChange={(val) => handleSliderOverdrive("CONTRAST", val)} />
                  <CustomSlider label="Zoom" min={1} max={10} step={0.1} value={zoom} showValue unit="x" onChange={(val) => handleSliderOverdrive("ZOOM", val)} />
                  
                  <div className="flex items-center justify-between border-t border-border/40 pt-4">
                    <span className="text-sm text-muted-foreground">GPIO Flash Emitter Pin</span>
                    <button disabled={!canControl} onClick={toggleFlashEmitter} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${flashEnabled ? "bg-emerald-500" : "bg-border"}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform duration-300 ${flashEnabled ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {/* ========================================================
              📦 EXTENSION MODULE 3: CAPTURED MEDIA ARCHIVE GALLERY
              ======================================================== */}
          <div className="mt-12 border-t border-border pt-10">
            <h2 className="text-2xl font-semibold tracking-tight mb-6 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-muted-foreground" /> Captured Media Buffer Gallery
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Loaded from database for agent <span className="font-mono">{selectedDevice || "—"}</span>. New captures appear here only after DB save.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* Photos Section */}
              <Card className="p-6 border border-border bg-card/40">
                <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                  <Camera className="w-4 h-4" /> Snapshots ({capturedPhotos.length})
                </h3>
                {capturedPhotos.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic bg-accent/5 p-4 rounded-lg text-center">No snapshots in database for this agent yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 max-h-[320px] overflow-auto pr-1">
                    {capturedPhotos.map((photo) => (
                      <div key={photo.id} className="group relative border border-border rounded-md overflow-hidden bg-black aspect-video flex items-center justify-center">
                        <img src={photo.url} alt="Snap" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <Button size="icon" variant="secondary" className="h-8 w-8" onClick={() => downloadAsset(photo.url, `snapshot_${photo.id}.jpg`)}>
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="destructive" className="h-8 w-8" onClick={() => clearGalleryItem(photo.id, "photo")}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <span className="absolute bottom-1 right-1 text-[10px] font-mono bg-black/70 px-1.5 py-0.5 rounded text-white">{photo.time}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Video Clips Section */}
              <Card className="p-6 border border-border bg-card/40">
                <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                  <Film className="w-4 h-4" /> Recorded Video Clips ({recordedClips.length})
                </h3>
                {recordedClips.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic bg-accent/5 p-4 rounded-lg text-center">No recordings in database for this agent yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 max-h-[320px] overflow-auto pr-1">
                    {recordedClips.map((clip) => (
                      <div key={clip.id} className="group relative border border-border rounded-md overflow-hidden bg-black aspect-video flex items-center justify-center">
                        {/* Displaying frame thumbnail with video runtime track icon badge */}
                        <video src={clip.url} className="w-full h-full object-cover brightness-70" muted playsInline />
                        <div className="absolute top-2 right-2 bg-red-600 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded text-white flex items-center gap-1">
                          <Video className="w-2.5 h-2.5" /> {clip.duration}
                        </div>
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <Button size="icon" variant="secondary" className="h-8 w-8" onClick={() => downloadAsset(clip.url, `recording_${clip.id}.webm`)}>
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="destructive" className="h-8 w-8" onClick={() => clearGalleryItem(clip.id, "video")}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <span className="absolute bottom-1 left-1 text-[10px] font-mono bg-black/70 px-1.5 py-0.5 rounded text-white">{clip.time}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

            </div>
          </div>

        </div>
      </main>
    </div>
  );
}   