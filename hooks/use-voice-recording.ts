import { useState, useRef, useCallback } from 'react';

export function useVoiceRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Try to use audio/webm;codecs=opus or fall back to default
      let options: MediaRecorderOptions = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options = { mimeType: 'audio/webm' };
        if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
          options = {};
        }
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }, []);

  const stopRecording = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!mediaRecorderRef.current) {
        reject(new Error('No media recorder found'));
        return;
      }

      const recorder = mediaRecorderRef.current;

      recorder.onstop = async () => {
        setIsRecording(false);
        setIsProcessing(true);

        try {
          // Get the actual mime type used by the recorder
          const mimeType = recorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

          // Ensure we have audio data
          if (audioBlob.size === 0) {
            throw new Error('No audio data recorded');
          }

          console.log('Audio blob size:', audioBlob.size, 'type:', mimeType);

          // Send to speech-to-text API
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');

          const response = await fetch('/api/speech-to-text', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || 'Failed to transcribe audio');
          }

          const data = await response.json();
          setIsProcessing(false);

          // Stop all tracks
          const tracks = recorder.stream?.getTracks() || [];
          tracks.forEach(track => track.stop());

          resolve(data.text);
        } catch (error) {
          setIsProcessing(false);
          // Stop all tracks even on error
          const tracks = recorder.stream?.getTracks() || [];
          tracks.forEach(track => track.stop());
          reject(error);
        }
      };

      recorder.stop();
    });
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      const tracks = mediaRecorderRef.current.stream?.getTracks() || [];
      tracks.forEach(track => track.stop());
      setIsRecording(false);
      audioChunksRef.current = [];
    }
  }, [isRecording]);

  return {
    isRecording,
    isProcessing,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
