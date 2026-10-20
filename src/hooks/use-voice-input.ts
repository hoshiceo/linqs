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
  onaudiostart?: (() => void) | null;
  onsoundstart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
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
  const isExplicitStopRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);

  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;

  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  const cancel = useCallback(() => {
    isExplicitStopRef.current = true;
    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore abort errors
    }
    recognitionRef.current = null;
    setIsStarting(false);
    setListening(false);
    setInterim("");
  }, []);

  const stop = useCallback(() => {
    isExplicitStopRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      cancel();
    }
  }, [cancel]);

  const start = useCallback(async () => {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      onErrorRef.current?.("音声入力は安全な接続（HTTPS または localhost）でのみ利用できます。");
      return;
    }

    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      onErrorRef.current?.("お使いのブラウザは音声入力に対応していません。Google Chrome、Microsoft Edge、Safari などをお試しください。");
      return;
    }

    // Set starting state immediately so UI responds right away
    setIsStarting(true);
    setInterim("");
    isExplicitStopRef.current = false;

    // First request microphone permission explicitly if mediaDevices API is available.
    // This provides a reliable browser permission prompt and descriptive errors.
    if (typeof navigator !== "undefined" && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately stop all audio tracks; SpeechRecognition manages its own capture.
        stream.getTracks().forEach((track) => track.stop());
      } catch (err) {
        setIsStarting(false);
        const errName = err instanceof Error ? err.name : "";
        if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
          onErrorRef.current?.("マイクへのアクセスが許可されていません。ブラウザのアドレスバー等でマイクを許可してください。");
        } else if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
          onErrorRef.current?.("マイクが見つかりませんでした。マイクが接続されているか確認してください。");
        } else {
          onErrorRef.current?.("マイクの起動に失敗しました。ブラウザの設定をご確認ください。");
        }
        return;
      }
    }

    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore
    }

    try {
      const recognition = new Ctor();
      recognition.lang = lang;
      // Note: Some WebKit/Safari versions have issues with continuous=true, but setting
      // continuous=true allows natural speech flow in Chromium.
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
        if (event.error === "aborted") {
          // Normal cancellation
          return;
        }
        if (event.error === "no-speech") {
          // Silence from user
          return;
        }

        setIsStarting(false);
        setListening(false);
        setInterim("");

        switch (event.error) {
          case "not-allowed":
          case "service-not-allowed":
            onErrorRef.current?.("マイクへのアクセスまたは音声認識サービスが許可されていません。ブラウザの設定をご確認ください。");
            break;
          case "audio-capture":
            onErrorRef.current?.("マイクの音声を検出できませんでした。マイクの接続をご確認ください。");
            break;
          case "network":
            onErrorRef.current?.("音声認識サービスとの通信に失敗しました。ネットワーク接続をご確認ください。");
            break;
          default:
            onErrorRef.current?.(`音声認識エラー: ${event.error}`);
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
      onErrorRef.current?.(
        err instanceof Error
          ? `音声認識を開始できませんでした: ${err.message}`
          : "音声認識を開始できませんでした。"
      );
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (listening || isStarting) {
      stop();
    } else {
      void start();
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
