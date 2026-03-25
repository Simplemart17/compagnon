/**
 * WAV Header Utilities
 *
 * Generates proper RIFF/WAV headers for raw PCM audio data.
 * Required on Android where MediaPlayer needs valid WAV headers
 * to play back raw PCM audio (iOS CoreAudio handles headerless PCM).
 */

/**
 * Create a 44-byte RIFF/WAV header for raw PCM16 audio.
 *
 * WAV file structure:
 *   Bytes 0-3:   "RIFF"
 *   Bytes 4-7:   file size - 8
 *   Bytes 8-11:  "WAVE"
 *   Bytes 12-15: "fmt "
 *   Bytes 16-19: 16 (PCM format chunk size)
 *   Bytes 20-21: 1 (PCM audio format)
 *   Bytes 22-23: numChannels
 *   Bytes 24-27: sampleRate
 *   Bytes 28-31: byteRate
 *   Bytes 32-33: blockAlign
 *   Bytes 34-35: bitsPerSample
 *   Bytes 36-39: "data"
 *   Bytes 40-43: data chunk size
 */
export function createWavHeader(
  dataLength: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);

  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const fileSize = dataLength + 36; // Total file size minus 8 bytes for RIFF header

  // "RIFF" chunk descriptor
  header[0] = 0x52; // R
  header[1] = 0x49; // I
  header[2] = 0x46; // F
  header[3] = 0x46; // F
  view.setUint32(4, fileSize, true); // ChunkSize (little-endian)

  // "WAVE" format
  header[8] = 0x57; // W
  header[9] = 0x41; // A
  header[10] = 0x56; // V
  header[11] = 0x45; // E

  // "fmt " sub-chunk
  header[12] = 0x66; // f
  header[13] = 0x6d; // m
  header[14] = 0x74; // t
  header[15] = 0x20; // (space)
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, channels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // "data" sub-chunk
  header[36] = 0x64; // d
  header[37] = 0x61; // a
  header[38] = 0x74; // t
  header[39] = 0x61; // a
  view.setUint32(40, dataLength, true); // Subchunk2Size

  return header;
}

/**
 * Prepend a WAV header to raw PCM base64 audio data.
 *
 * Decodes base64 PCM data, prepends a proper WAV header, and re-encodes
 * to base64. This is necessary because base64 concatenation only works
 * when the first segment is aligned to 3-byte boundaries (44 bytes is not).
 *
 * @param pcmBase64 - Raw PCM audio data encoded as base64
 * @param sampleRate - Audio sample rate (e.g. 24000 for OpenAI Realtime API)
 * @param channels - Number of audio channels (1 for mono)
 * @param bitsPerSample - Bits per sample (16 for PCM16)
 * @returns Base64-encoded WAV file (header + PCM data)
 */
export function prependWavHeader(
  pcmBase64: string,
  sampleRate: number = 24000,
  channels: number = 1,
  bitsPerSample: number = 16
): string {
  // Decode base64 PCM data to binary string
  const pcmBinary = atob(pcmBase64);
  const pcmLength = pcmBinary.length;

  // Create WAV header
  const header = createWavHeader(pcmLength, sampleRate, channels, bitsPerSample);

  // Combine header + PCM data into a single binary string
  let headerBinary = "";
  for (let i = 0; i < header.length; i++) {
    headerBinary += String.fromCharCode(header[i]);
  }

  // Re-encode the combined data to base64
  return btoa(headerBinary + pcmBinary);
}
