"use client";

/**
 * useAudioDevices — lists available mic inputs + speaker outputs.
 *
 * Browsers only return real device labels AFTER the page has been granted
 * microphone permission. Before then, labels are empty strings (and we fall
 * back to "Microphone N" / "Speakers N").
 *
 * `setSinkId` is supported on Chrome/Edge/Firefox; Safari does not implement
 * it as of 2026. `outputSupported` reports the runtime capability so the UI
 * can disable the output dropdown gracefully.
 */
import { useCallback, useEffect, useState } from "react";

export type AudioDevice = {
  deviceId: string;
  label: string;
};

type SinkCapableElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export type UseAudioDevices = {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  selectedInput: string;
  selectedOutput: string;
  hasPermission: boolean;
  outputSupported: boolean;
  setSelectedInput: (deviceId: string) => void;
  setSelectedOutput: (deviceId: string) => void;
  refresh: () => Promise<void>;
  requestPermission: () => Promise<void>;
};

const DEFAULT_INPUT_LABEL = "System default microphone";
const DEFAULT_OUTPUT_LABEL = "System default output";

export function useAudioDevices(): UseAudioDevices {
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>("");
  const [selectedOutput, setSelectedOutput] = useState<string>("");
  const [hasPermission, setHasPermission] = useState(false);
  const [outputSupported, setOutputSupported] = useState(false);

  // Detect setSinkId support on mount (client only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const audio = document.createElement("audio") as SinkCapableElement;
    setOutputSupported(typeof audio.setSinkId === "function");
  }, []);

  const refresh = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const ins: AudioDevice[] = [];
    const outs: AudioDevice[] = [];
    let inCounter = 1;
    let outCounter = 1;
    let anyLabeled = false;
    for (const d of all) {
      if (d.kind === "audioinput") {
        const label = d.label || `Microphone ${inCounter++}`;
        if (d.label) anyLabeled = true;
        ins.push({ deviceId: d.deviceId, label });
      } else if (d.kind === "audiooutput") {
        const label = d.label || `Speakers ${outCounter++}`;
        if (d.label) anyLabeled = true;
        outs.push({ deviceId: d.deviceId, label });
      }
    }
    setInputs(ins);
    setOutputs(outs);
    setHasPermission(anyLabeled);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch (err) {
      console.warn("[audio-devices] permission request failed", err);
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const handler = () => void refresh();
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, [refresh]);

  return {
    inputs,
    outputs,
    selectedInput,
    selectedOutput,
    hasPermission,
    outputSupported,
    setSelectedInput,
    setSelectedOutput,
    refresh,
    requestPermission,
  };
}

/**
 * Apply a sinkId to an HTMLAudioElement, gracefully no-oping if unsupported
 * (Safari) or if no device is selected.
 */
export async function applySinkId(
  el: HTMLAudioElement | null,
  sinkId: string,
): Promise<void> {
  if (!el) return;
  const target = el as SinkCapableElement;
  if (typeof target.setSinkId !== "function") return;
  if (!sinkId) {
    try {
      await target.setSinkId("");
    } catch {
      // ignore
    }
    return;
  }
  try {
    await target.setSinkId(sinkId);
  } catch (err) {
    console.warn("[audio-devices] setSinkId failed", err);
  }
}

export const DEFAULTS = {
  inputLabel: DEFAULT_INPUT_LABEL,
  outputLabel: DEFAULT_OUTPUT_LABEL,
};
