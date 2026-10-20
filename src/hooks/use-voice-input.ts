"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser SpeechRecognition types – only the subset this hook uses.
 * The Web Speech API is not yet in lib.dom.d.ts for all browsers,
 * so we declare just enough to compile without pulling in external type packages.
 */
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

/** Return the browser SpeechRecognition constructor, or `null` if unavailable. */
function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseVoiceInputOptions {
  /** BCP-47 language tag. Defaults to `"ja-JP"`. */
  lang?: string;
  /** Called with the finalised transcript text. */
  onTranscript: (text: string) => void;
}

export interface UseVoiceInputReturn {
  /** Whether the browser supports the Web Speech API. */
  supported: boolean;
  /** Whether the recogniser is currently listening. */
  listening: boolean;
  /** Interim (not-yet-finalised) transcript shown while the user speaks. */
  interim: string;
  /** Toggle listening on/off. */
  toggle: () => void;
  /** Stop listening without inserting the interim result. */
  cancel: () => void;
}

/**
 * Hook that wraps the Web Speech API for voice input.
 *
 * It returns a stable `toggle` callback to start/stop listening and an `interim`
 * string to show real-time transcription feedback. Once the browser finalises
 * the result the `onTranscript` callback is called with the complete text.
 *
 * The recogniser runs in `continuous` mode so the user can speak multiple
 * sentences in a single session.
 */
export function useVoiceInput({
  lang = "ja-JP",
  onTranscript,
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Detect support on mount (client-only).
  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    // Clean up any prior instance.
    recognitionRef.current?.abort();

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setListening(true);
      setInterim("");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }
      if (finalText) {
        onTranscriptRef.current(finalText);
        setInterim("");
      } else {
        setInterim(interimText);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "aborted" is triggered by our own cancel() call – not an actual error.
      if (event.error === "aborted") return;
      // "no-speech" just means the user was silent; we can keep listening.
      if (event.error === "no-speech") return;
      cancel();
    };

    recognition.onend = () => {
      setListening(false);
      setInterim("");
      recognitionRef.current = null;
    };

    recognition.start();
  }, [lang, cancel]);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
    } else {
      start();
    }
  }, [listening, start, stop]);

  return { supported, listening, interim, toggle, cancel };
}
