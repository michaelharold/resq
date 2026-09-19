"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null };

/** Web Speech API "hold to speak". `supported` is false on browsers without it (the button is then hidden). */
export function useSpeech(onText: (t: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Rec | null>(null);
  const buf = useRef("");
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!C) return;
    const r = new C();
    r.lang = "en-IN";
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      buf.current = t;
      cb.current(t);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setSupported(true);
    return () => r.abort();
  }, []);

  const start = useCallback(() => {
    if (!rec.current || listening) return;
    buf.current = "";
    try { rec.current.start(); setListening(true); } catch { /* already started */ }
  }, [listening]);
  const stop = useCallback(() => { try { rec.current?.stop(); } catch { /* not started */ } }, []);
  return { supported, listening, start, stop };
}
