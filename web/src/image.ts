const MAX_SIDE = 1600;
const QUALITY = 0.8;

/**
 * Réduit une photo de téléphone (souvent 4 à 12 Mo) en JPEG de ~200-400 Ko avant l'envoi :
 * envoi rapide même en 4G sur un chantier, et coût IA réduit.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Photo illisible"))), "image/jpeg", QUALITY)
  );
}
