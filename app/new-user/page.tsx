"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { motion } from "framer-motion";
import {
  Camera,
  Mic,
  Square,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useVoiceRecording } from "@/hooks/use-voice-recording";
import { cn } from "@/lib/utils";

const MAX_VIDEO_DURATION = 5000; // 5 seconds in milliseconds

export default function NewUserPage() {
  const [prompt, setPrompt] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isCapturingVideo, setIsCapturingVideo] = useState(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isHoldingRef = useRef(false);

  const {
    isRecording: isRecordingAudio,
    isProcessing,
    startRecording,
    stopRecording,
  } = useVoiceRecording();

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
      if (videoStream) {
        videoStream.getTracks().forEach((track) => track.stop());
      }
    },
    [preview, videoStream],
  );

  const toggleAudioRecording = useCallback(async () => {
    if (isRecordingAudio) {
      try {
        const transcript = await stopRecording();
        setPrompt((value) =>
          value ? `${value.trim()}\n${transcript}` : transcript,
        );
        toast.success("Voice captured and transcribed.");
      } catch (error) {
        console.error("Failed to transcribe audio input:", error);
        toast.error("Recording stopped but transcription failed.");
      }
      return;
    }

    try {
      await startRecording();
      toast("Recording started…");
    } catch (error) {
      console.error("Failed to access microphone:", error);
      toast.error("Could not access microphone permissions.");
    }
  }, [isRecordingAudio, stopRecording, startRecording]);

  const capturePhoto = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.play();

      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });

      // Wait 1 second for camera to adjust exposure/focus
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0);
      }

      stream.getTracks().forEach((track) => track.stop());

      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `photo-${Date.now()}.jpg`, {
            type: "image/jpeg",
          });
          setAttachment(file);
          if (preview) URL.revokeObjectURL(preview);
          setPreview(URL.createObjectURL(file));
          toast.success("Photo captured!");
        }
      }, "image/jpeg");
    } catch (error) {
      console.error("Failed to capture photo:", error);
      toast.error("Could not access camera.");
    }
  }, [preview]);

  const startVideoRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: true,
      });

      setVideoStream(stream);
      setIsCapturingVideo(true);
      chunksRef.current = [];

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "video/webm",
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const file = new File([blob], `video-${Date.now()}.webm`, {
          type: "video/webm",
        });
        setAttachment(file);
        if (preview) URL.revokeObjectURL(preview);
        setPreview(URL.createObjectURL(file));

        stream.getTracks().forEach((track) => track.stop());
        setVideoStream(null);
        setIsCapturingVideo(false);
        setRecordingStartTime(null);
        toast.success("Video captured!");
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecordingStartTime(Date.now());

      // Auto-stop after 5 seconds
      setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          mediaRecorder.stop();
        }
      }, MAX_VIDEO_DURATION);

      toast("Recording video (max 5 seconds)…");
    } catch (error) {
      console.error("Failed to start video recording:", error);
      toast.error("Could not access camera/microphone.");
      setIsCapturingVideo(false);
    }
  }, [preview]);

  const stopVideoRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const removeAttachment = useCallback(() => {
    setAttachment(null);
    if (preview) {
      URL.revokeObjectURL(preview);
      setPreview(null);
    }
  }, [preview]);

  const handleCameraPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (isCapturingVideo) return;

    isHoldingRef.current = false;

    // Set a timer for hold detection (500ms)
    holdTimerRef.current = setTimeout(() => {
      isHoldingRef.current = true;
      startVideoRecording();
    }, 500);
  }, [isCapturingVideo, startVideoRecording]);

  const handleCameraPointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();

    // Clear the hold timer
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    // If we're recording video, stop it
    if (isCapturingVideo) {
      stopVideoRecording();
      return;
    }

    // If it wasn't a hold (quick click), take a photo
    if (!isHoldingRef.current) {
      capturePhoto();
    }

    isHoldingRef.current = false;
  }, [isCapturingVideo, stopVideoRecording, capturePhoto]);

  const handleCameraPointerCancel = useCallback(() => {
    // Clear the hold timer if pointer is cancelled
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    isHoldingRef.current = false;
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() && !attachment) {
      toast.error("Please add a description or capture media.");
      return;
    }

    try {
      setIsSubmitting(true);

      const formData = new FormData();
      formData.append("text", prompt);

      if (attachment) {
        formData.append("attachments", attachment, attachment.name);
      }

      const response = await fetch("/api/traffic-intake", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to process submission");
      }

      toast.success("Traffic report submitted successfully!");
      setPrompt("");
      setAttachment(null);
      if (preview) {
        URL.revokeObjectURL(preview);
        setPreview(null);
      }
    } catch (error) {
      console.error("Traffic intake failed:", error);
      toast.error("Unable to submit report right now.");
    } finally {
      setIsSubmitting(false);
    }
  }, [prompt, attachment, preview]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-black">
      <div className="absolute inset-0 bg-[radial-gradient(#0f4739_1px,transparent_1px)] [background-size:24px_24px] opacity-10 pointer-events-none" />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-12">
        {/* Video preview during recording */}
        {isCapturingVideo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
            />
            <div className="absolute top-4 right-4 flex items-center gap-2 text-red-500">
              <div className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
              <span className="text-sm font-medium">
                Recording ({recordingStartTime ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0}s / 5s)
              </span>
            </div>
          </div>
        )}

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <h1 className="text-4xl font-bold text-nvidia-green mb-2">
            Traffic Report
          </h1>
          <p className="text-muted-foreground">
            Record audio or capture video to report traffic situations
          </p>
        </motion.div>

        {/* Giant Buttons */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col sm:flex-row gap-8 items-center justify-center"
        >
          {/* Audio Recording Button */}
          <button
            onClick={toggleAudioRecording}
            disabled={isProcessing}
            className={cn(
              "relative flex h-48 w-48 items-center justify-center rounded-full border-8 transition-all duration-300",
              isRecordingAudio
                ? "border-red-500 bg-red-500/20 shadow-[0_0_60px_rgba(239,68,68,0.5)]"
                : "border-nvidia-green bg-nvidia-green/10 shadow-[0_0_60px_rgba(0,255,170,0.3)] hover:bg-nvidia-green/20 hover:scale-105",
              isProcessing && "opacity-50"
            )}
          >
            {isRecordingAudio ? (
              <div className="flex flex-col items-center gap-2">
                <Square size={64} className="text-red-500" />
                <span className="text-sm font-medium text-red-500">Stop</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Mic size={64} className="text-nvidia-green" />
                <span className="text-sm font-medium text-nvidia-green">
                  {isProcessing ? "Processing..." : "Record Audio"}
                </span>
              </div>
            )}
          </button>

          {/* Camera/Video Button */}
          <button
            onPointerDown={handleCameraPointerDown}
            onPointerUp={handleCameraPointerUp}
            onPointerCancel={handleCameraPointerCancel}
            onPointerLeave={handleCameraPointerCancel}
            className={cn(
              "relative flex h-48 w-48 items-center justify-center rounded-full border-8 transition-all duration-300 touch-none",
              isCapturingVideo
                ? "border-red-500 bg-red-500/20 shadow-[0_0_60px_rgba(239,68,68,0.5)]"
                : "border-nvidia-cyan bg-nvidia-cyan/10 shadow-[0_0_60px_rgba(0,229,255,0.3)] hover:bg-nvidia-cyan/20 hover:scale-105"
            )}
          >
            {isCapturingVideo ? (
              <div className="flex flex-col items-center gap-2">
                <Square size={64} className="text-red-500" />
                <span className="text-sm font-medium text-red-500">Stop</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Camera size={64} className="text-nvidia-cyan" />
                <span className="text-sm font-medium text-nvidia-cyan">
                  Tap / Hold
                </span>
              </div>
            )}
          </button>
        </motion.div>

        {/* Text Input Box */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="w-full max-w-2xl space-y-4"
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the traffic situation or type your report here..."
            className="w-full min-h-[120px] resize-none rounded-2xl border-2 border-nvidia-green/30 bg-black/60 px-6 py-4 text-base text-foreground placeholder:text-muted-foreground shadow-inner backdrop-blur transition focus:border-nvidia-green focus:outline-none focus:ring-2 focus:ring-nvidia-green/40"
          />
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || (!prompt.trim() && !attachment)}
            className={cn(
              "w-full rounded-2xl border-2 border-nvidia-green bg-nvidia-green px-8 py-4 text-lg font-semibold text-black transition-all duration-300 shadow-[0_0_40px_rgba(0,255,170,0.3)]",
              "hover:bg-nvidia-green/80 hover:scale-[1.02]",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            )}
          >
            {isSubmitting ? "Submitting..." : "Submit Report"}
          </button>
        </motion.div>

        {/* Attachment Preview */}
        {attachment && preview && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-nvidia-cyan/30 bg-black/60 backdrop-blur"
          >
            <button
              onClick={removeAttachment}
              className="absolute right-2 top-2 z-10 rounded-full bg-black/80 p-2 text-muted-foreground transition hover:text-red-400"
            >
              <X size={20} />
            </button>
            <div className="aspect-video w-full overflow-hidden bg-black/60">
              {attachment.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="Captured photo"
                  className="h-full w-full object-cover"
                />
              ) : (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={preview}
                  className="h-full w-full object-cover"
                  controls
                  preload="metadata"
                />
              )}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              {attachment.type.startsWith("image/") ? (
                <Camera size={16} className="text-nvidia-cyan" />
              ) : (
                <Video size={16} className="text-nvidia-cyan" />
              )}
              <span className="truncate">{attachment.name}</span>
            </div>
          </motion.div>
        )}

        {/* Instructions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-center text-sm text-muted-foreground max-w-md"
        >
          <p>
            Tap the microphone to record audio. Tap the camera for a photo, or hold for 5-second video.
          </p>
        </motion.div>
      </div>
    </main>
  );
}
