import QRCode from 'qrcode';
import jsQR from 'jsqr';

export async function drawQR(canvas: HTMLCanvasElement, value: string) {
  await QRCode.toCanvas(canvas, value, {
    width: 480, margin: 4, errorCorrectionLevel: 'M',
    color: { dark: '#29352b', light: '#ffffff' },
  });
}

function decodeImage(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이 기기에서는 QR 사진을 읽을 수 없습니다.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data;
}

export async function readQRImage(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error('20MB 이하의 이미지를 선택하세요.');
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('사진을 열 수 없습니다. 다른 사진을 선택하세요.'));
      image.src = url;
    });
    const result = decodeImage(image, image.naturalWidth, image.naturalHeight);
    if (!result) throw new Error('QR을 찾을 수 없습니다. 선명한 QR 이미지를 선택하세요.');
    return result;
  } finally { URL.revokeObjectURL(url); }
}

export async function scanQR(video: HTMLVideoElement, onResult: (value: string) => void, signal: AbortSignal) {
  if (signal.aborted) return;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('카메라를 사용할 수 없습니다. QR 이미지를 불러오세요.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 960 }, height: { ideal: 720 } },
  });
  let frame = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    signal.removeEventListener('abort', stop);
  };
  if (signal.aborted) { stop(); return; }
  signal.addEventListener('abort', stop, { once: true });
  video.srcObject = stream;
  try { await video.play(); }
  catch (error) { stop(); throw error; }
  let previous = 0;
  const scan = (time: number) => {
    if (stopped) return;
    if (time - previous > 250 && video.readyState >= 2) {
      previous = time;
      let value: string | undefined;
      try { value = decodeImage(video, video.videoWidth, video.videoHeight); }
      catch { /* A frame can be unavailable during camera startup. */ }
      if (value) { stop(); onResult(value); return; }
    }
    frame = requestAnimationFrame(scan);
  };
  if (!stopped) frame = requestAnimationFrame(scan);
}
