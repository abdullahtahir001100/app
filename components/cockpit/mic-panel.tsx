"use client";

import { unwrapDeviceBinaryFrame } from "@/lib/binary-frame";
import { Mic, MicOff, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type DispatchFn = (
  action: string,
  payload?: Record<string, unknown>,
  target?: string
) => { ok: boolean; reason?: string };

type SubscribeFn = (
  listener: (event: { type: string; data?: ArrayBuffer | Blob; packet?: Record<string, unknown> }) => void
) => () => void;

const FRAME_AUDIO_STREAM = 0x0a;

export function MicPanel({
  deviceId,
  subscribe,
  dispatch,
}: {
  deviceId: string;
  subscribe: SubscribeFn;
  dispatch: DispatchFn;
}) {
  const [listening, setListening] = useState(false);
  const [volume, setVolume] = useState(1);
  const [level, setLevel] = useState(0);
  const [sampleRate, setSampleRate] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const playheadRef = useRef(0);
  const listeningRef = useRef(false);
  listeningRef.current = listening;

  const handleAudioFrame = useCallback((frame: Uint8Array) => {
    if (!listeningRef.current || frame.length < 7) return;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const rate = view.getUint32(1, false) || 48000;
    const pcm = frame.subarray(5);
    const sampleCount = Math.floor(pcm.length / 2);
    if (sampleCount === 0) return;

    let ctx = audioCtxRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      gainRef.current = gain;
    }
    void ctx.resume();
    setSampleRate(rate);

    const buffer = ctx.createBuffer(1, sampleCount, rate);
    const channel = buffer.getChannelData(0);
    const pcmView = new DataView(pcm.buffer, pcm.byteOffset, sampleCount * 2);
    let peak = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const s = pcmView.getInt16(i * 2, true) / 32768;
      channel[i] = s;
      const a = Math.abs(s);
      if (a > peak) peak = a;
    }
    setLevel(peak);

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(gainRef.current ?? ctx.destination);
    const now = ctx.currentTime;
    if (playheadRef.current < now) playheadRef.current = now + 0.05;
    node.start(playheadRef.current);
    playheadRef.current += buffer.duration;
  }, [volume]);

  const handleRef = useRef(handleAudioFrame);
  handleRef.current = handleAudioFrame;

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "binary" || !event.data) return;
      const process = (buf: Uint8Array) => {
        const { deviceId: fromId, frame } = unwrapDeviceBinaryFrame(buf);
        if (fromId && fromId !== deviceId) return;
        if (frame.length < 1 || frame[0] !== FRAME_AUDIO_STREAM) return;
        handleRef.current(frame);
      };
      if (event.data instanceof Blob) void event.data.arrayBuffer().then((b) => process(new Uint8Array(b)));
      else process(new Uint8Array(event.data));
    });
  }, [subscribe, deviceId]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
  }, [volume]);

  const start = () => {
    setListening(true);
    playheadRef.current = 0;
    // Unlock/resume the audio context inside the click gesture.
    if (!audioCtxRef.current) {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      gainRef.current = gain;
    }
    void audioCtxRef.current.resume();
    dispatch("START_AUDIO_STREAM", {}, deviceId);
  };

  const stop = useCallback(() => {
    setListening(false);
    setLevel(0);
    dispatch("STOP_AUDIO_STREAM", {}, deviceId);
  }, [deviceId, dispatch]);

  useEffect(() => {
    return () => {
      dispatch("STOP_AUDIO_STREAM", {}, deviceId);
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex items-center gap-2">
        {!listening ? (
          <button onClick={start} className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
            <Mic className="h-3.5 w-3.5" /> Listen
          </button>
        ) : (
          <button onClick={stop} className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">
            <MicOff className="h-3.5 w-3.5" /> Mute
          </button>
        )}
        <div className="flex items-center gap-1.5">
          <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-24 accent-emerald-600"
          />
        </div>
      </div>

      {/* VU meter */}
      <div className="mt-4">
        <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-500 transition-[width] duration-75"
            style={{ width: `${Math.min(100, Math.round(level * 140))}%` }}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          {listening ? (sampleRate ? `${(sampleRate / 1000).toFixed(1)} kHz · mono` : "waiting for audio…") : "microphone idle"}
        </p>
      </div>
    </div>
  );
}
