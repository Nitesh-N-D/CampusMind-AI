import { useEffect, useRef, useState } from "react";

// Minimal shape of the non-standard SpeechRecognition API - not in
// lib.dom.d.ts, so declared locally rather than pulling in a whole
// @types package for a few fields.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LANG_MAP: Record<string, string> = {
  en: "en-US",
  ta: "ta-IN",
  hi: "hi-IN",
};

export function useVoiceInput(language: string, onFinalTranscript: (text: string) => void) {
  const [supported] = useState(() => getSpeechRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const start = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    setError(null);
    const recognition = new Ctor();
    recognition.lang = LANG_MAP[language] ?? "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (e) => {
      const result = e.results[e.results.length - 1];
      const transcript = result?.[0]?.transcript?.trim();
      if (transcript) onFinalTranscript(transcript);
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "permission-denied") {
        setError("Microphone access was blocked. Allow it in your browser's site settings to use voice input.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        setError("Couldn't hear that clearly. Please try again.");
      }
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const stop = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  return { supported, listening, error, start, stop };
}
