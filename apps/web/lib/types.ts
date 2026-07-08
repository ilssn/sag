export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export type SourceStatus = "active" | "paused" | "error";
export type SourceType = "document" | "web" | "message" | "audio";
export interface Source {
  id: string;
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

export interface Citation {
  n: number;
  chunk_id: string | null;
  heading: string;
  snippet: string;
  score: number;
  source_id: string | null;
  source_name?: string | null;
}

export type BindingTargetType = "source" | "mcp_server";

export interface Persona {
  system_prompt?: string;
  greeting?: string;
  tools?: string[];
}

export interface ActivityItem {
  type: "document" | "thread";
  id: string;
  source_id?: string;
  title: string;
  subtitle: string | null;
  status: DocumentStatus | null;
  at: string;
}

export interface Agent {
  id: string;
  name: string;
  avatar: string;
  persona: Persona;
  is_default?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Binding {
  id: string;
  target_type: BindingTargetType;
  target_id: string;
  config: Record<string, unknown>;
}

export interface ModelConfig {
  llm_base_url: string | null;
  llm_model: string;
  llm_temperature: number;
  llm_max_tokens: number;
  llm_api_key_set: boolean;
  embedding_model: string;
  embedding_base_url: string | null;
  embedding_dimensions: number | null;
  embedding_api_key_set: boolean;
  search_strategy: "multi" | "vector" | "atomic";
  search_top_k: number;
  sag_language: "zh" | "en";
}

export type ModelConfigPatch = Partial<{
  llm_base_url: string;
  llm_api_key: string;
  llm_model: string;
  llm_temperature: number;
  llm_max_tokens: number;
  embedding_model: string;
  embedding_base_url: string;
  embedding_api_key: string;
  embedding_dimensions: number | null;
  search_strategy: "multi" | "vector" | "atomic";
  search_top_k: number;
  sag_language: "zh" | "en";
}>;

export interface SourceMcpDescriptor {
  source_id: string;
  source_name: string;
  tools: string[];
  http: { transport: string; url: string; note: string };
  stdio: { command: string; args: string[]; env: Record<string, string>; note: string };
}

export interface Thread {
  id: string;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
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
  source_name?: string | null;
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
  allowed_upload_exts?: string[];
}
