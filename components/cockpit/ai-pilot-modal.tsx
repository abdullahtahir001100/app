"use client";

import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Mic,
  MicOff,
  Send,
  Loader2,
  CheckCircle2,
  BrainCircuit,
  Volume2,
  Cpu,
  FileSpreadsheet,
  FileText,
  FolderTree,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

interface AiPilotModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
}

export function AiPilotModal({ open, onOpenChange, deviceId }: AiPilotModalProps) {
  const [prompt, setPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [executionSteps, setExecutionSteps] = useState<string[]>([]);
  const [spokenReply, setSpokenReply] = useState("");
  const [detectedMood, setDetectedMood] = useState("focused");
  const [memoryUsedMB, setMemoryUsedMB] = useState("0.05");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (open) {
      // Fetch current memory stats
      fetch("/api/ai-pilot/memory")
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.stats) {
            setMemoryUsedMB(data.stats.usedMB || "0.05");
            setDetectedMood(data.stats.currentMood || "focused");
          }
        })
        .catch(() => {});
    }
  }, [open]);

  // Execute prompt
  const handleExecute = async (inputPrompt?: string) => {
    const textToRun = inputPrompt || prompt;
    if (!textToRun.trim() || isProcessing) return;

    setIsProcessing(true);
    setExecutionSteps(["Initializing Hybrid Turbo Orchestrator…"]);
    setSpokenReply("");

    try {
      const res = await fetch("/api/ai-pilot/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: textToRun,
          deviceId,
          engine: "hybrid",
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Execution failed");

      setExecutionSteps(data.plan.steps || ["Task executed on remote PC"]);
      setSpokenReply(data.plan.spokenReplyUrdu || "Task completed.");
      setDetectedMood(data.plan.moodDetected || "focused");

      if (data.memoryStats?.usedMB) {
        setMemoryUsedMB(data.memoryStats.usedMB);
      }

      // Play synthesized audio response via browser speech synthesis
      if ("speechSynthesis" in window && data.plan.spokenReplyUrdu) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(data.plan.spokenReplyUrdu);
        utterance.rate = data.voice?.rate || 1.05;
        utterance.pitch = data.voice?.pitch || 1.0;
        window.speechSynthesis.speak(utterance);
      }

      toast.success("Autonomous task executed on remote device!");
      setPrompt("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Execution error: ${msg}`);
      setExecutionSteps((prev) => [...prev, `Error: ${msg}`]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Toggle Low-Bandwidth Voice Recording (<100 KB/s)
  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
        audioBitsPerSecond: 16000, // Ultra-low bandwidth 16 kbps (<15 KB/s)
      });

      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Data = (reader.result as string)?.split(",")[1];
          if (!base64Data) return;

          setIsProcessing(true);
          setExecutionSteps(["Transcribing low-bandwidth voice stream (<1.5s)…"]);

          try {
            const res = await fetch("/api/ai-pilot/voice-stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                audioBase64: base64Data,
                mimeType: "audio/webm",
                deviceId,
              }),
            });

            const data = await res.json();
            if (!data.ok) throw new Error(data.error || "Voice processing failed");

            setPrompt(data.transcription?.text || "");
            setExecutionSteps(data.plan?.steps || ["Voice command executed"]);
            setSpokenReply(data.plan?.spokenReplyUrdu || "Done");
            setDetectedMood(data.plan?.moodDetected || "focused");

            if ("speechSynthesis" in window && data.plan?.spokenReplyUrdu) {
              window.speechSynthesis.cancel();
              const utterance = new SpeechSynthesisUtterance(data.plan.spokenReplyUrdu);
              utterance.rate = data.voice?.rate || 1.1;
              window.speechSynthesis.speak(utterance);
            }
            toast.success("Voice command executed!");
          } catch (err: unknown) {
            toast.error("Voice processing failed");
          } finally {
            setIsProcessing(false);
          }
        };
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(250);
      setIsRecording(true);
    } catch {
      toast.error("Could not access microphone.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-card border-border shadow-2xl p-6">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-600 border border-purple-500/20">
                <Sparkles className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <DialogTitle className="text-lg font-display tracking-tight flex items-center gap-2">
                  Zenvora AI Auto-Pilot
                  <Badge variant="secondary" className="text-[10px] bg-purple-500/10 text-purple-600 border-purple-500/20 font-mono">
                    Hybrid Turbo Mode
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Autonomous Microsoft UFO + OpenClaw agent executing live on remote target ({deviceId || "active agent"}).
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-lg border border-border">
              <BrainCircuit className="w-3.5 h-3.5 text-purple-500" />
              <span>{memoryUsedMB} MB / 2 GB</span>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Quick Action Suggestion Chips */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Quick Autonomous Actions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleExecute("Excel open karke Pakistan Economy 2026 assignment bana do formulas aur chart ke sath")}
                disabled={isProcessing}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-card/50 hover:bg-purple-500/5 hover:border-purple-500/30 text-left text-xs transition group"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0 group-hover:scale-110 transition-transform" />
                <span className="line-clamp-1">Excel Assignment (Formulas + 3D Chart)</span>
              </button>

              <button
                type="button"
                onClick={() => handleExecute("Word document create karo topic Strategic Business Brief")}
                disabled={isProcessing}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-card/50 hover:bg-purple-500/5 hover:border-purple-500/30 text-left text-xs transition group"
              >
                <FileText className="w-4 h-4 text-blue-500 shrink-0 group-hover:scale-110 transition-transform" />
                <span className="line-clamp-1">Word Document (Executive Summary)</span>
              </button>

              <button
                type="button"
                onClick={() => handleExecute("Desktop ke files ko extensions ke hisab se organize kar do")}
                disabled={isProcessing}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-card/50 hover:bg-purple-500/5 hover:border-purple-500/30 text-left text-xs transition group"
              >
                <FolderTree className="w-4 h-4 text-amber-500 shrink-0 group-hover:scale-110 transition-transform" />
                <span className="line-clamp-1">Clean & Organize Desktop Folders</span>
              </button>

              <button
                type="button"
                onClick={() => handleExecute("Device network latency check karo aur report display karo")}
                disabled={isProcessing}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-card/50 hover:bg-purple-500/5 hover:border-purple-500/30 text-left text-xs transition group"
              >
                <Zap className="w-4 h-4 text-purple-500 shrink-0 group-hover:scale-110 transition-transform" />
                <span className="line-clamp-1">Speed & Diagnostic Assessment</span>
              </button>
            </div>
          </div>

          {/* Spoken Response Preview */}
          {spokenReply && (
            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-900 dark:text-purple-200 flex items-start gap-2.5">
              <Volume2 className="w-4 h-4 text-purple-500 shrink-0 mt-0.5 animate-bounce" />
              <div>
                <span className="font-semibold block text-[11px] text-purple-600 dark:text-purple-400">
                  AI Voice Copilot (Tone: {detectedMood}):
                </span>
                <p className="mt-0.5 leading-relaxed">{spokenReply}</p>
              </div>
            </div>
          )}

          {/* Execution Steps Log */}
          {executionSteps.length > 0 && (
            <div className="p-3 rounded-xl bg-muted/40 border border-border space-y-1.5 max-h-40 overflow-y-auto font-mono text-[11px]">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground uppercase font-sans pb-1 border-b border-border/50">
                <span>Autonomous Execution Trace</span>
                <span>Sub-second Latency</span>
              </div>
              {executionSteps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2 text-foreground/90">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}

          {/* Input Bar & Voice Mic */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              type="button"
              variant={isRecording ? "destructive" : "outline"}
              size="icon"
              onClick={toggleRecording}
              disabled={isProcessing}
              className={`h-10 w-10 shrink-0 rounded-xl transition-all ${isRecording ? "animate-pulse ring-2 ring-red-500/50" : ""}`}
              title={isRecording ? "Stop voice command" : "Ultra-low bandwidth voice talk (<100 KB/s)"}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-purple-600" />}
            </Button>

            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleExecute()}
              placeholder="e.g. Excel me Pakistan Economy assignment bana do formulas ke sath..."
              disabled={isProcessing}
              className="flex-1 h-10 text-xs rounded-xl"
            />

            <Button
              type="button"
              onClick={() => handleExecute()}
              disabled={!prompt.trim() || isProcessing}
              className="h-10 px-4 rounded-xl gap-1.5 bg-purple-600 hover:bg-purple-700 text-white shadow-sm"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" /> Run
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AiPilotModal;
