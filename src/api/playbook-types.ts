import type { AutomationPlatform } from "@/api/automation-types";

export type ControlStatus = "active" | "deprecated" | "deprioritized";

export interface PlaybookImageBlock {
  type: "image";
  path: string;
  alt?: string;
  width?: string;
  caption?: string;
  url: string | null;
  exists: boolean;
}

export interface PlaybookParagraphBlock {
  type: "paragraph" | "caption";
  text: string;
}

export interface PlaybookHeadingBlock {
  type: "heading";
  level: number;
  text: string;
}

export interface PlaybookCodeBlock {
  type: "code";
  language: string | null;
  text: string;
}

export interface PlaybookListBlock {
  type: "list";
  ordered: boolean;
  items: { number: number | null; text: string }[];
}

export interface PlaybookTableBlock {
  type: "table";
  columns: string[];
  rows: Record<string, string>[];
}

export type PlaybookBlock =
  | PlaybookImageBlock
  | PlaybookParagraphBlock
  | PlaybookHeadingBlock
  | PlaybookCodeBlock
  | PlaybookListBlock
  | PlaybookTableBlock;

export interface ControlStep {
  step_key: string;
  step_id_source: "declared" | "auto";
  content_hash: string;
  step_index: number;
  number: number | null;
  step_title: string;
  text: string;
  content: PlaybookBlock[];
}

export interface ControlReference {
  label: string;
  url: string;
}

export interface ControlSourceArchive {
  label: string;
  path: string;
  exists: boolean;
  file_name: string;
  size_bytes: number | null;
  sha256: string | null;
  url: string | null;
}

export interface ControlSummary {
  control_id: string;
  risk_id: string | null;
  title: string;
  status: ControlStatus;
  required: boolean;
  step_count: number;
  playbook_revision: string;
  has_source_archive: boolean;
}

export interface ControlDetail extends ControlSummary {
  platform: AutomationPlatform;
  summary: string;
  source_file: string;
  status_source: string;
  intro: PlaybookBlock[];
  steps: ControlStep[];
  references: ControlReference[];
  source_archives: ControlSourceArchive[];
  source_download_url: string | null;
}

export interface ControlSourceMetadata {
  control_id: string;
  exists: boolean;
  download_enabled: boolean;
  file_name?: string;
  path?: string;
  size_bytes?: number | null;
  sha256?: string | null;
  download_url?: string;
  declared: { path: string; exists: boolean }[];
}

export interface PlaybookWarning {
  code: string;
  message: string;
  file?: string;
  path?: string;
  control_id?: string;
  risk_id?: string;
}

export interface PlaybookStatus {
  platform: AutomationPlatform;
  env_key: string | null;
  configured_path: string | null;
  readable: boolean;
  risk_count: number;
  control_count: number;
  warnings: PlaybookWarning[];
  revision: string | null;
  error: string | null;
  source_download_enabled: boolean;
}
