export type Role = "admin" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export type SourceStatus = "active" | "paused" | "error";
export type SourceType = "document" | "web" | "message" | "conversation" | "audio";
export type NamespaceKind = "memory" | "knowledge" | "custom";

export interface Namespace {
  id: string;
  name: string;
  kind: NamespaceKind;
  icon: string;
  color: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface Source {
  id: string;
  namespace_id: string | null;
  name: string;
  description: string;
  source_type: SourceType;
  connector_kind: string;
  status: SourceStatus;
  document_count: number;
  chunk_count: number;
  event_count: number;
  created_at: string;
  updated_at: string;
}

export interface Connector {
  kind: string;
  title: string;
  description: string;
  supports_sync: boolean;
  config_fields: Array<Record<string, unknown>>;
}

export type DocumentStatus =
  | "pending"
  | "loading"
  | "extracting"
  | "ready"
  | "failed";

export interface Doc {
  id: string;
  source_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: DocumentStatus;
  chunk_count: number;
  event_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Thread {
  id: string;
  source_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  n: number;
  chunk_id: string | null;
  heading: string;
  snippet: string;
  score: number;
  source_id: string | null;
  source_name?: string | null;
}

export interface Message {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Citation[];
  created_at: string;
}

export type SoulOrigin = "user" | "book_entity" | "mount" | "import";
export type SoulStatus = "active" | "archived";
export type BindingTargetType = "namespace" | "source";

export interface Persona {
  system_prompt?: string;
  greeting?: string;
  voice?: string;
  traits?: string[];
  guardrails?: string[];
  search_strategy?: string | null;
  top_k?: number | null;
  temperature?: number | null;
}

export interface Soul {
  id: string;
  name: string;
  avatar: string;
  persona: Persona;
  origin: SoulOrigin;
  status: SoulStatus;
  memory_namespace_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Binding {
  id: string;
  target_type: BindingTargetType;
  target_id: string;
  mode: string;
}

export interface SoulThread {
  id: string;
  soul_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface SoulMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  author: string | null;
  citations: Citation[];
  created_at: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  description: string;
  heat: number;
}

export interface Section {
  chunk_id: string | null;
  heading: string;
  content: string;
  score: number;
  rank: number;
  source_id: string | null;
}

export interface SearchResponse {
  query: string;
  sections: Section[];
  stats: Record<string, unknown>;
}

export interface Capabilities {
  llm_configured: boolean;
  llm_model: string;
  embedding_model: string;
  vector_provider: string;
  language: string;
  search_strategy: string;
  max_upload_mb: number;
}
