"use client";

import type { CreateUIMessage, UIMessage, UseChatHelpers, UseChatOptions } from "@ai-sdk/react";

type ChatRequestOptions = {
  headers?: Record<string, string> | Headers;
  body?: object;
  data?: any;
};
import { motion } from "framer-motion";
import type React from "react";
import {
  useRef,
  useEffect,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { useLocalStorage, useWindowSize } from "usehooks-ts";

import { cn, sanitizeUIMessages } from "@/lib/utils";
import { useVoiceRecording } from "@/hooks/use-voice-recording";
import { ArrowUp, Square, Mic } from "lucide-react";

import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

const suggestedActions = [
  {
    title: "What is the weather",
    label: "in San Francisco?",
    action: "What is the weather in San Francisco?",
  },
  {
    title: "How is python useful",
    label: "for AI engineers?",
    action: "How is python useful for AI engineers?",
  },
];

export function MultimodalInput({
  chatId,
  input,
  setInput,
  isLoading,
  stop,
  messages,
  setMessages,
  sendMessage,
  handleSubmit,
  className,
}: {
  chatId: string;
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  stop: () => void;
  messages: Array<UIMessage>;
  setMessages: Dispatch<SetStateAction<Array<UIMessage>>>;
  sendMessage: UseChatHelpers<UIMessage>['sendMessage']
  handleSubmit: (
    event?: {
      preventDefault?: () => void;
    },
    chatRequestOptions?: ChatRequestOptions
  ) => void;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  const { isRecording, isProcessing, startRecording, stopRecording } = useVoiceRecording();

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${
        textareaRef.current.scrollHeight + 2
      }px`;
    }
  };

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    ""
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    adjustHeight();
  };

  const submitForm = useCallback(() => {
    handleSubmit(undefined, {});
    setLocalStorageInput("");

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [handleSubmit, setLocalStorageInput, width]);

  const handleVoiceInput = useCallback(async () => {
    if (isRecording) {
      try {
        const transcription = await stopRecording();
        setInput(transcription);
        adjustHeight();
      } catch (error) {
        console.error('Error transcribing audio:', error);
        toast.error('Failed to transcribe audio');
      }
    } else {
      try {
        await startRecording();
        toast.success('Recording started...');
      } catch (error) {
        console.error('Error starting recording:', error);
        toast.error('Failed to start recording');
      }
    }
  }, [isRecording, startRecording, stopRecording, setInput]);

  return (
    <div className="relative w-full flex flex-col gap-4">
      {messages.length === 0 && (
        <div className="grid sm:grid-cols-2 gap-2 w-full">
          {suggestedActions.map((suggestedAction, index) => (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ delay: 0.05 * index }}
              key={`suggested-action-${suggestedAction.title}-${index}`}
              className={index > 1 ? "hidden sm:block" : "block"}
            >
              <Button
                variant="ghost"
                onClick={async () => {
                  sendMessage({
                    role: "user",
                    parts: [
                      {
                        type: "text",
                        text: suggestedAction.action,
                      },
                    ],
                  });
                }}
                className="text-left border-2 border-nvidia-green/40 hover:border-nvidia-green hover:bg-nvidia-green/5 rounded-xl px-4 py-3.5 text-sm flex-1 gap-1 sm:flex-col w-full h-auto justify-start items-start transition-all"
              >
                <span className="font-medium">{suggestedAction.title}</span>
                <span className="text-muted-foreground">
                  {suggestedAction.label}
                </span>
              </Button>
            </motion.div>
          ))}
        </div>
      )}

      <Textarea
        ref={textareaRef}
        placeholder="Send a message..."
        value={input || ""}
        onChange={handleInput}
        className={cn(
          "min-h-[24px] max-h-[calc(75dvh)] overflow-hidden resize-none rounded-xl !text-base bg-muted border-2 border-nvidia-green/30 focus:border-nvidia-green focus:ring-2 focus:ring-nvidia-green/50",
          className
        )}
        rows={3}
        autoFocus
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();

            if (isLoading) {
              toast.error("Please wait for the model to finish its response!");
            } else {
              submitForm();
            }
          }
        }}
      />

      <div className="absolute bottom-2 right-2 flex gap-2">
        {!isLoading && (
          <Button
            className={cn(
              "rounded-full p-1.5 h-fit m-0.5 border-2 border-nvidia-green bg-nvidia-green/10 hover:bg-nvidia-green hover:text-black",
              isRecording && "bg-red-500 hover:bg-red-600 border-red-500 animate-pulse"
            )}
            onClick={(event) => {
              event.preventDefault();
              handleVoiceInput();
            }}
            disabled={isProcessing}
          >
            <Mic size={14} />
          </Button>
        )}

        {isLoading ? (
          <Button
            className="rounded-full p-1.5 h-fit m-0.5 border-2 border-nvidia-green bg-nvidia-green/10 hover:bg-nvidia-green hover:text-black"
            onClick={(event) => {
              event.preventDefault();
              stop();
              setMessages((messages) => sanitizeUIMessages(messages));
            }}
          >
            <Square size={14} />
          </Button>
        ) : (
          <Button
            className="rounded-full p-1.5 h-fit m-0.5 border-2 border-nvidia-green bg-nvidia-green text-black hover:bg-nvidia-green/80"
            onClick={(event) => {
              event.preventDefault();
              submitForm();
            }}
            disabled={!input || input.length === 0}
          >
            <ArrowUp size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}
