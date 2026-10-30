/** Soft-deleted rows keep `deletedAt` (epoch ms). Live rows omit it. */
export function isLive(doc: { deletedAt?: number | null }) {
  return doc.deletedAt == null;
}
