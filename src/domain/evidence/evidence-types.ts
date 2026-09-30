/**
 * The evidence item shape shared by evidence lists and viewers.
 */

export interface EvidenceItem {
  id: string;
  name: string;
  kind: string;
  url?: string;
  textContent?: string | null;
  source?: string;
  downloadName?: string;
  sizeBytes?: number;
}
