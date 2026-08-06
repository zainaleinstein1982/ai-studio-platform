/* ------------------------------------------------------------------ */
/* Shared browser image helpers (Image→3D · Image→Video tabs)          */
/* ------------------------------------------------------------------ */

export const MAX_FILE_BYTES = 12 * 1024 * 1024;

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode that image"));
    img.src = dataUrl;
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

export function sampleStats(canvas: HTMLCanvasElement): { avgColor: string; brightness: number } {
  const px = document.createElement("canvas");
  px.width = 1;
  px.height = 1;
  const pctx = px.getContext("2d");
  if (!pctx) return { avgColor: "#808080", brightness: 0.5 };
  pctx.drawImage(canvas, 0, 0, 1, 1);
  const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
  return {
    avgColor: "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""),
    brightness: (0.299 * r + 0.587 * g + 0.114 * b) / 255,
  };
}

export async function downscaleImage(img: HTMLImageElement, maxDim = 512) {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { dataUrl, width, height, ...sampleStats(canvas) };
}

/** Display-only simulation of background removal: checkerboard + radial mask. */
export function bgRemovedUrl(img: HTMLImageElement, w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const cell = Math.max(4, Math.floor(Math.min(w, h) / 10));
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      ctx.fillStyle = (x / cell + y / cell) % 2 === 0 ? "#e7e2d8" : "#d4cec1";
      ctx.fillRect(x, y, cell, cell);
    }
  }
  ctx.drawImage(img, 0, 0, w, h);
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.1, w / 2, h / 2, Math.max(w, h) * 0.72);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return canvas.toDataURL("image/png");
}

/** Display-only simulation of enhancement: contrast + saturation boost. */
export function enhancedUrl(img: HTMLImageElement, w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.filter = "contrast(1.14) saturate(1.22)";
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}
