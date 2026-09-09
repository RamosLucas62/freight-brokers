export type PodReviewStatus = 'confirmed' | 'divergent' | 'unverifiable';

export interface PodEvidence {
  page: number | null;
  text: string | null;
  bounding_box: {x: number; y: number; width: number; height: number} | null;
}

export interface PodField<T> {
  value: T | null;
  confidence: number;
  evidence: PodEvidence | null;
}

export interface PodFields {
  load_number: PodField<string>;
  bol_number: PodField<string>;
  delivery_date: PodField<string>;
  delivery_time: PodField<string>;
  receiver_name: PodField<string>;
  delivery_location: PodField<string>;
  signature_present: PodField<boolean>;
  damage_or_shortage_noted: PodField<boolean>;
  exception_notes: PodField<string>;
}

export interface PodQuality {
  score: number;
  rotation_degrees: number;
  perspective_distortion: boolean;
  blur: boolean;
  glare_or_shadow: boolean;
  cropped: boolean;
  reasons: string[];
}

export interface PodExtractionResult {
  source_file: string;
  source_kind: 'ocr' | 'csv' | 'xlsx';
  fields: PodFields;
  quality: PodQuality;
  requires_human_review: boolean;
  raw: Record<string, unknown>;
}

export type PodReference = Partial<{
  load_number: string;
  bol_number: string;
  delivery_date: string;
  receiver_name: string;
  delivery_location: string;
  signature_required: boolean;
}>;

export interface PodAssessment {
  status: PodReviewStatus;
  reasons: string[];
  matched_fields: string[];
  divergent_fields: string[];
  unverifiable_fields: string[];
}
