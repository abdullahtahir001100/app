"use client";

import { unwrapDeviceBinaryFrame } from "@/lib/binary-frame";
import { gatewayClient } from "@/lib/gateway-client";
import { Mic, MicOff, Radio, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type DispatchFn = (
  action: string,
  payload?: Record<string, unknown>,
  target?: string
) => { ok: boolean; reason?: string };

type SubscribeFn = (
  listener: (event: {
    type: string;
    data?: ArrayBuffer | Blob;
    packet?: Record<string, unknown>;
  }) => void
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
  const [talking, setTalking] = useState(false);
  const [includeMic, setIncludeMic] = useState(true);
  const [includeSystem, setIncludeSystem] = useState(true);
  const [volume, setVolume] = useState(1);
  const [level, setLevel] = useState(0);
  const [talkLevel, setTalkLevel] = useState(0);
  const [sampleRate, setSampleRate] = useState(0);
  const [error, setError] = useState("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const playheadRef = useRef(0);
  const listeningRef = useRef(false);
  listeningRef.current = listening;

  const talkCtxRef = useRef<AudioContext | null>(null);
  const talkStreamRef = useRef<MediaStream | null>(null);
  const talkProcRef = useRef<ScriptProcessorNode | null>(null);
  const talkingRef = useRef(false);
  talkingRef.current = talking;

  const handleAudioFrame = useCallback(
    (frame: Uint8Array) => {
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
    },
    [volume]
  );

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
      if (event.data instanceof Blob)
        void event.data.arrayBuffer().then((b) => process(new Uint8Array(b)));
      else process(new Uint8Array(event.data));
    });
  }, [subscribe, deviceId]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
  }, [volume]);

  const startListen = () => {
    setError("");
    if (!includeMic && !includeSystem) {
      setError("Mic ya system audio — kam az kam ek select karo.");
      return;
    }
    setListening(true);
    playheadRef.current = 0;
    if (!audioCtxRef.current) {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      gainRef.current = gain;
    }
    void audioCtxRef.current.resume();
    dispatch(
      "START_AUDIO_STREAM",
      {
        include_mic: includeMic,
        include_system: includeSystem,
      },
      deviceId
    );
  };

  const stopListen = useCallback(() => {
    setListening(false);
    setLevel(0);
    dispatch("STOP_AUDIO_STREAM", {}, deviceId);
  }, [deviceId, dispatch]);

  const stopTalk = useCallback(() => {
    talkingRef.current = false;
    setTalking(false);
    setTalkLevel(0);
    try {
      talkProcRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    talkProcRef.current = null;
    talkStreamRef.current?.getTracks().forEach((t) => t.stop());
    talkStreamRef.current = null;
    void talkCtxRef.current?.close();
    talkCtxRef.current = null;
    dispatch("STOP_SPEAKER_PLAY", {}, deviceId);
  }, [deviceId, dispatch]);

  const startTalk = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      const ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor: widely supported; buffer ~85ms @ 48k
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const silent = ctx.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = (ev) => {
        if (!talkingRef.current) return;
        const input = ev.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        let peak = 0;
        for (let i = 0; i < input.length; i += 1) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = (s * 32767) | 0;
          const a = Math.abs(s);
          if (a > peak) peak = a;
        }
        setTalkLevel(peak);
        gatewayClient.sendAudioPlay(deviceId, ctx.sampleRate || 48000, pcm);
      };
      source.connect(processor);
      processor.connect(silent);
      silent.connect(ctx.destination);

      talkStreamRef.current = stream;
      talkCtxRef.current = ctx;
      talkProcRef.current = processor;
      talkingRef.current = true;
      setTalking(true);
      dispatch("START_SPEAKER_PLAY", { sample_rate: ctx.sampleRate || 48000 }, deviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mic permission denied");
      stopTalk();
    }
  };

  useEffect(() => {
    return () => {
      dispatch("STOP_AUDIO_STREAM", {}, deviceId);
      dispatch("STOP_SPEAKER_PLAY", {}, deviceId);
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
      try {
        talkProcRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      talkStreamRef.current?.getTracks().forEach((t) => t.stop());
      void talkCtxRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 px-2.5 py-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Listen sources
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={includeMic}
            disabled={listening}
            onChange={(e) => setIncludeMic(e.target.checked)}
            className="accent-emerald-600"
          />
          Microphone (voice)
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={includeSystem}
            disabled={listening}
            onChange={(e) => setIncludeSystem(e.target.checked)}
            className="accent-sky-600"
          />
          System audio (videos / apps)
        </label>
        <p className="text-[10px] text-muted-foreground">
          System = jo PC speakers pe chal raha ho (YouTube etc.). Change pehle, phir Listen.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!listening ? (
          <button
            type="button"
            onClick={startListen}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            <Mic className="h-3.5 w-3.5" />
            Listen
          </button>
        ) : (
          <button
            type="button"
            onClick={stopListen}
            className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
          >
            <MicOff className="h-3.5 w-3.5" />
            Mute listen
          </button>
        )}

        {!talking ? (
          <button
            type="button"
            onClick={() => void startTalk()}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
          >
            <Radio className="h-3.5 w-3.5" />
            Speak to PC
          </button>
        ) : (
          <button
            type="button"
            onClick={stopTalk}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
          >
            <Radio className="h-3.5 w-3.5" />
            Stop speaking
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">Listen vol</span>
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

      <div>
        <p className="mb-1 text-[10px] text-muted-foreground">PC → you</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-500 transition-[width] duration-75"
            style={{ width: `${Math.min(100, Math.round(level * 140))}%` }}
          />
        </div>
      </div>
      <div>
        <p className="mb-1 text-[10px] text-muted-foreground">You → PC speakers</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-violet-500 transition-[width] duration-75"
            style={{ width: `${Math.min(100, Math.round(talkLevel * 140))}%` }}
          />
        </div>
      </div>

      <p className="font-mono text-[10px] text-muted-foreground">
        {listening
          ? [
              sampleRate ? `${(sampleRate / 1000).toFixed(1)} kHz` : "waiting…",
              includeMic ? "mic" : null,
              includeSystem ? "system" : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : "listen idle"}
        {" · "}
        {talking ? "speaking to PC…" : "talk idle"}
      </p>
      {error && <p className="text-[11px] text-rose-500">{error}</p>}
    </div>
  );
}
