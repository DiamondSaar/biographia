import { api } from "../api.js";
import { encryptBytes, encryptFileMeta, packEncryptedBlob } from "./masterKey.ts";
import { generateThumbnail } from "./thumbnails.js";

/**
 * Единая точка загрузки вложения к записи - используется и
 * AttachmentList.jsx (существующая запись), и AddRecordForm.jsx (новая
 * запись), обеими зонами. Одна функция вместо двух копий одной и той же
 * логики шифрования, которые могли бы незаметно разойтись - то же
 * решение, что attachmentUpload.ts на мобильном приложении
 * (biographia-mobile), независимая, но идейно идентичная копия.
 */
export async function uploadRecordAttachment(recordId, zone, file, subkey) {
  const thumbnailBlob = await generateThumbnail(file);
  const formData = new FormData();

  if (zone === "personal") {
    if (!subkey) throw new Error("personal zone attachment requires an unlocked diary");

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const { ciphertext, nonce } = encryptBytes(subkey, fileBytes);
    formData.append("file", new Blob([packEncryptedBlob(ciphertext, nonce)]), "encrypted");

    const { ciphertext: encryptedMeta, nonce: metaNonce } = encryptFileMeta(subkey, file.name, file.type);
    formData.append("encrypted_meta", encryptedMeta);
    formData.append("meta_nonce", metaNonce);

    if (thumbnailBlob) {
      const thumbBytes = new Uint8Array(await thumbnailBlob.arrayBuffer());
      const { ciphertext: thumbCiphertext, nonce: thumbNonce } = encryptBytes(subkey, thumbBytes);
      formData.append("thumbnail", new Blob([packEncryptedBlob(thumbCiphertext, thumbNonce)]), "encrypted-thumb");
    }
  } else {
    formData.append("file", file);
    if (thumbnailBlob) formData.append("thumbnail", thumbnailBlob, "thumbnail.jpg");
  }

  return api.uploadAttachment(recordId, formData);
}
