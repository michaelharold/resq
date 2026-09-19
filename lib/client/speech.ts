"use client";
/*
 * Hands-free voice (docs/UPGRADE.md §4): browser-native speech recognition, tap once to start.
 *   window.webkitSpeechRecognition ?? window.SpeechRecognition · continuous=false · interimResults=true · lang "en-IN"
 * The live transcript goes to `onText` while the person speaks; recognition stops by itself on silence and `onFinal`
 * fires exactly once per session with the non-empty transcript. No transcript → `onError` ("no-speech", "not-allowed"…).
 * `supported` is false on browsers without the API (the mic button is then hidden; typing still works).
 */
import { useCallback, useEffect, useRef, useState } from "react";

type RecResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: RecResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};
type RecCtor = new () => Rec;

export type SpeechError = "no-speech" | "not-allowed" | "audio-capture" | "network" | "unknown";
export type SpeechHandlers = {
  onText: (transcript: string) => void;      // live transcript (interim + final so far)
  onFinal: (transcript: string) => void;     // once, when recognition ends with a non-empty transcript
  onError?: (error: SpeechError) => void;    // recognition ended with nothing usable
  lang?: string;                             // default "en-IN"
};
export type SpeechControls = {
  supported: boolean; listening: boolean; error: SpeechError | null;
  start: () => void; stop: () => void; cancel: () => void; toggle: () => void;
};

export function speechCtor(): RecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { webkitSpeechRecognition?: RecCtor; SpeechRecognition?: RecCtor };
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null;
}

/** Human wording for a recognition failure. */
export function speechErrorText(e: SpeechError): string {
  if (e === "no-speech") return "Didn't catch that. Tap the mic and try again, or type it.";
  if (e === "not-allowed") return "Microphone is blocked. Allow microphone access, or type instead.";
  if (e === "audio-capture") return "No microphone found. Type what is happening instead.";
  if (e === "network") return "Voice needs a connection right now. Type what is happening instead.";
  return "Voice input failed. Type what is happening instead.";
}

function toSpeechError(code: string | undefined): SpeechError {
  if (code === "no-speech") return "no-speech";
  if (code === "not-allowed" || code === "service-not-allowed") return "not-allowed";
  if (code === "audio-capture") return "audio-capture";
  if (code === "network") return "network";
  return "unknown";
}

export function useSpeech(handlers: SpeechHandlers): SpeechControls {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<SpeechError | null>(null);
  const session = useRef<{ rec: Rec; cancelled: boolean } | null>(null); // the recognition session in progress
  const h = useRef(handlers);
  h.current = handlers;

  // Decided after mount so the server render and the first client render agree (no hydration mismatch).
  useEffect(() => {
    setSupported(speechCtor() !== null);
    return () => {
      const s = session.current;
      session.current = null;
      if (s) { s.cancelled = true; s.rec.onresult = s.rec.onend = s.rec.onerror = null; try { s.rec.abort(); } catch { /* not started */ } }
    };
  }, []);

  const start = useCallback(() => {
    const C = speechCtor();
    if (!C || session.current) return;
    // A fresh recogniser per session: reusing one after onend is unreliable in Chrome and Safari.
    const r = new C();
    const s = { rec: r, cancelled: false };
    let transcript = "", failure: SpeechError | null = null, finished = false;
    r.lang = h.current.lang ?? "en-IN";
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0]?.transcript ?? "";
      transcript = t.replace(/\s+/g, " ").trim();
      if (transcript && !s.cancelled) h.current.onText(transcript);
    };
    r.onerror = (e) => {
      if (e?.error === "aborted") s.cancelled = true;
      else failure = toSpeechError(e?.error);
    };
    r.onend = () => {
      if (finished) return; // some engines fire onend twice: onFinal must fire once
      finished = true;
      if (session.current === s) session.current = null;
      setListening(false);
      if (s.cancelled) return;
      if (transcript) { h.current.onFinal(transcript); return; } // words beat a late "no-speech" error
      const err = failure ?? "no-speech";
      setError(err);
      h.current.onError?.(err);
    };
    session.current = s;
    setError(null);
    try { r.start(); setListening(true); }
    catch { session.current = null; setListening(false); setError("unknown"); h.current.onError?.("unknown"); }
  }, []);

  /** Stop listening and use what was heard (onFinal still fires). */
  const stop = useCallback(() => { try { session.current?.rec.stop(); } catch { /* not started */ } }, []);
  /** Stop listening and throw the transcript away (no onFinal, no onError). */
  const cancel = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.cancelled = true;
    try { s.rec.abort(); } catch { /* not started */ }
  }, []);
  const toggle = useCallback(() => { if (session.current) stop(); else start(); }, [start, stop]);

  return { supported, listening, error, start, stop, cancel, toggle };
}
