"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
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

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseVoiceInputOptions {
  lang?: string;
  onTranscript: (text: string) => void;
  onError?: (error: string) => void;
}

export interface UseVoiceInputReturn {
  supported: boolean;
  listening: boolean;
  isStarting: boolean;
  interim: string;
  toggle: () => void;
  cancel: () => void;
}

export function useVoiceInput({
  lang = "ja-JP",
  onTranscript,
  onError,
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [interim, setInterim] = useState("");

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);

  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;

  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  const cancel = useCallback(() => {
    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore
    }
    recognitionRef.current = null;
    setIsStarting(false);
    setListening(false);
    setInterim("");
  }, []);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      cancel();
    }
  }, [cancel]);

  const start = useCallback(() => {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      onErrorRef.current?.("音声入力は安全な接続（HTTPS または localhost）でのみ利用できます。");
      return;
    }

    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      onErrorRef.current?.("お使いのブラウザは音声入力に対応していません。Google Chrome、Microsoft Edge、Safari などをお試しください。");
      return;
    }

    setIsStarting(true);
    setInterim("");

    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore
    }

    try {
      const recognition = new Ctor();
      recognition.lang = lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognitionRef.current = recognition;

      recognition.onstart = () => {
        setIsStarting(false);
        setListening(true);
        setInterim("");
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalText = "";
        let interimText = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) {
            finalText += transcript;
          } else {
            interimText += transcript;
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
        console.warn("SpeechRecognition error:", event.error);

        if (event.error === "aborted") {
          return;
        }
        if (event.error === "no-speech") {
          return;
        }

        setIsStarting(false);
        setListening(false);
        setInterim("");

        switch (event.error) {
          case "not-allowed":
          case "service-not-allowed":
            onErrorRef.current?.(
              `マイクまたは音声認識へのアクセスが許可されていません [${event.error}]。ブラウザのアドレスバーの許可、およびMacの「システム設定 > プライバシーとセキュリティ」内の「マイク」と「音声認識」をご確認ください。`
            );
            break;
          case "audio-capture":
            onErrorRef.current?.("マイクの音声を検出できませんでした [audio-capture]。マイクの接続やMacの入力音量設定をご確認ください。");
            break;
          case "network":
            onErrorRef.current?.("音声認識サービスとの通信に失敗しました [network]。インターネット接続やVPN設定をご確認ください。");
            break;
          default:
            onErrorRef.current?.(`音声認識エラー [${event.error}]`);
            break;
        }
      };

      recognition.onend = () => {
        setIsStarting(false);
        setListening(false);
        setInterim("");
        recognitionRef.current = null;
      };

      recognition.start();
    } catch (err) {
      setIsStarting(false);
      setListening(false);
      console.error("SpeechRecognition start exception:", err);
      onErrorRef.current?.(
        err instanceof Error
          ? `音声認識を開始できませんでした (${err.message})`
          : "音声認識を開始できませんでした。"
      );
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (listening || isStarting) {
      stop();
    } else {
      start();
    }
  }, [listening, isStarting, start, stop]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    };
  }, []);

  return { supported, listening, isStarting, interim, toggle, cancel };
}
