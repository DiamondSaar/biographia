// Client-side thumbnail generation for attachments - mirrors the mobile
// app's src/utils/thumbnails.ts (biographia-mobile): the server can never
// generate a thumbnail for a personal-zone file (it only ever sees
// ciphertext), so BOTH zones use the same client-side step rather than
// having two different code paths (open/org server-side vs personal
// client-side). Native browser APIs only (canvas, <video>) - no new
// dependency, see frontend/package.json which has none of this already.

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_QUALITY = 0.6;

function canvasToBlob(source, sourceWidth, sourceHeight) {
  const scale = THUMBNAIL_WIDTH / sourceWidth;
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas_to_blob_failed"))), "image/jpeg", THUMBNAIL_QUALITY);
  });
}

async function imageThumbnail(file) {
  const bitmap = await createImageBitmap(file);
  try {
    return await canvasToBlob(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}

function videoThumbnail(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, video.duration / 2 || 0);
    };
    video.onseeked = () => {
      canvasToBlob(video, video.videoWidth, video.videoHeight)
        .then(resolve)
        .catch(reject)
        .finally(() => URL.revokeObjectURL(url));
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("video_load_failed"));
    };
  });
}

/**
 * Возвращает Blob миниатюры (image/jpeg) или null, если для этого типа
 * файла превью не имеет смысла (документы и т.п.) - см. iconForMimeType
 * в компонентах списка вложений. Никогда не бросает исключение - вызов
 * при загрузке вложения не должен срываться из-за битого/нестандартного
 * файла, миниатюра - необязательное улучшение.
 */
export async function generateThumbnail(file) {
  try {
    if (file.type.startsWith("image/")) return await imageThumbnail(file);
    if (file.type.startsWith("video/")) return await videoThumbnail(file);
    return null;
  } catch {
    return null;
  }
}
