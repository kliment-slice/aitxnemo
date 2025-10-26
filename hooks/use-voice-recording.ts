import { useState, useRef, useCallback } from 'react';
import { API_URL } from '@/lib/api';

export function useVoiceRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      // Request high-quality audio with specific constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,  // High quality sample rate
          channelCount: 1,    // Mono to reduce file size
        }
      });

      // Try to use the best supported audio format
      let options: MediaRecorderOptions = {};

      // Prefer formats that work best with STT services
      const preferredFormats = [
        'audio/wav',                   // Uncompressed, highest quality for STT
        'audio/mp4;codecs=mp4a.40.2',  // AAC - good quality, widely supported
        'audio/webm;codecs=opus',      // OPUS - good compression, good quality
        'audio/mp4',                   // Generic MP4
        'audio/webm',                  // Generic WebM
        'audio/ogg;codecs=opus'        // OGG OPUS fallback
      ];

      for (const format of preferredFormats) {
        if (MediaRecorder.isTypeSupported(format)) {
          options = { mimeType: format };
          console.log(`[Voice] Using audio format: ${format}`);
          break;
        }
      }

      if (!options.mimeType) {
        console.warn('[Voice] No preferred audio format supported, using default');
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          console.log(`[Voice] Data chunk: ${event.data.size} bytes, type: ${event.data.type}`);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('[Voice] MediaRecorder error:', event);
      };

      // Start recording with smaller intervals for better data capture
      mediaRecorder.start(250); // Collect data every 250ms
      setIsRecording(true);

      console.log(`[Voice] Recording started with options:`, options);
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

          // Enhanced audio validation
          if (audioBlob.size === 0) {
            throw new Error('No audio data recorded - microphone may not be working');
          }

          if (audioBlob.size < 1000) {
            throw new Error('Audio recording too short - please record for at least 1 second');
          }

          console.log(`[Voice] Audio blob created: size=${audioBlob.size} bytes, type=${mimeType}`);
          console.log(`[Voice] Total chunks collected: ${audioChunksRef.current.length}`);

          // Create a more descriptive filename based on the mime type
          let filename = 'recording.webm';
          if (mimeType.includes('mp4')) {
            filename = 'recording.m4a';
          } else if (mimeType.includes('ogg')) {
            filename = 'recording.ogg';
          } else if (mimeType.includes('wav')) {
            filename = 'recording.wav';
          }

          // Send to speech-to-text API
          const formData = new FormData();
          formData.append('audio', audioBlob, filename);

          console.log(`[Voice] Sending to STT API: ${filename}, ${audioBlob.size} bytes`);

          const response = await fetch(`${API_URL}/api/speech-to-text`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            // Handle specific case where backend might not be available
            if (response.status === 405 || response.status === 404) {
              console.error('[Voice] STT API not available:', response.status);
              throw new Error('Speech-to-text service is currently unavailable. Please try again later.');
            }

            const errorText = await response.text();
            let errorData;
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { detail: errorText || 'Unknown error' };
            }
            console.error('[Voice] STT API error:', response.status, errorData);
            throw new Error(errorData.detail || `Server error: ${response.status}`);
          }

          const data = await response.json();
          console.log('[Voice] STT API response:', data);

          setIsProcessing(false);

          // Stop all tracks
          const tracks = recorder.stream?.getTracks() || [];
          tracks.forEach(track => track.stop());

          // Validate the transcription result
          if (!data.text || data.text.trim().length === 0) {
            console.warn('[Voice] Empty transcription received');
            if (data.warning) {
              throw new Error(`Transcription warning: ${data.warning}`);
            } else {
              throw new Error('Empty transcription - audio may be unclear or too quiet');
            }
          }

          console.log(`[Voice] Transcription successful: "${data.text}"`);
          resolve(data.text);
        } catch (error) {
          console.error('[Voice] Processing error:', error);
          setIsProcessing(false);
          // Stop all tracks even on error
          const tracks = recorder.stream?.getTracks() || [];
          tracks.forEach(track => track.stop());

          // Provide specific error messages for common network issues
          if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
            reject(new Error('Unable to connect to speech-to-text service. Please check your internet connection and try again.'));
          } else {
            reject(error);
          }
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
