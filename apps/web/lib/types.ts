import type { SearchStrategy } from "./retrieval-config";

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
export type DocumentParser = "auto" | "markitdown" | "mineru";
export type EffectiveDocumentParser = Exclude<DocumentParser, "auto">;
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
  | "paused"
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
  progress: number;
  token_usage: number;
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
  llm_context_window: number;
  llm_temperature: number;
  llm_max_tokens: number;
  llm_timeout_ms: number;
  llm_max_retries: number;
  llm_api_key_set: boolean;
  embedding_model: string;
  embedding_base_url: string | null;
  embedding_dimensions: number | null;
  embedding_api_key_set: boolean;
  document_parser: DocumentParser;
  mineru_base_url: string | null;
  mineru_version: "2.0" | "2.5";
  mineru_api_key_set: boolean;
  effective_document_parser: EffectiveDocumentParser;
  document_extract_concurrency: number;
  search_strategy: SearchStrategy;
  search_top_k: number;
  sag_language: "zh" | "en";
}

export type ModelConfigPatch = Partial<{
  llm_base_url: string;
  llm_api_key: string;
  llm_model: string;
  llm_context_window: number;
  llm_temperature: number;
  llm_max_tokens: number;
  llm_timeout_ms: number;
  llm_max_retries: number;
  embedding_model: string;
  embedding_base_url: string;
  embedding_api_key: string;
  embedding_dimensions: number | null;
  document_parser: DocumentParser;
  mineru_base_url: string | null;
  mineru_version: "2.0" | "2.5";
  mineru_api_key: string;
  document_extract_concurrency: number;
  search_strategy: SearchStrategy;
  search_top_k: number;
  sag_language: "zh" | "en";
}>;

export interface ModelSetupStatus {
  required: boolean;
  environment_configured: boolean;
  database_configured: boolean;
}

export interface McpToolDetail {
  name: string;
  label: string;
  description: string;
}

export interface SourceMcpDescriptor {
  source_id: string;
  source_name: string;
  tools: string[];
  tool_details: McpToolDetail[];
  http: {
    transport: string;
    url: string;
    headers?: Record<string, string>;
    note: string;
  };
  stdio: { command: string; args: string[]; env: Record<string, string>; note: string };
}

export interface KnowledgeMcpDescriptor {
  name: string;
  scope: "knowledge_base";
  source_count: number;
  tools: string[];
  tool_details: McpToolDetail[];
  http: {
    transport: string;
    url: string;
    headers: Record<string, string>;
    note: string;
  };
  stdio: { command: string; args: string[]; env: Record<string, string>; note: string };
}

export interface Thread {
  id: string;
  agent_id: string;
  archived?: boolean;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageStep {
  kind: "thinking" | "tool" | "answer";
  step: number;
  name?: string;
  label?: string;
  args?: string;
  arguments?: Record<string, unknown>;
  details?: {
    count?: number;
    sources?: { id?: string; name?: string }[];
    matches?: {
      n?: number;
      chunk_id?: string | null;
      heading?: string;
      snippet?: string;
      score?: number;
      source_id?: string | null;
      source_name?: string;
    }[];
    output_preview?: string;
  };
  ms?: number;
  count?: number;
  error?: string;
}

export interface MessageAttachment {
  id: string;
  name?: string;
  media_type?: string;
}

export interface Message {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Citation[];
  attachments?: MessageAttachment[];
  steps?: MessageStep[];
  created_at: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  description: string;
  heat: number;
}

export interface SourceGraphDocument {
  id: string;
  filename: string;
  status: DocumentStatus;
  chunk_count: number;
  event_count: number;
  created_at: string;
}

export interface SourceGraphEvent {
  id: string;
  document_id: string | null;
  title: string;
  summary: string;
  category: string;
  rank: number;
  parent_id: string | null;
  chunk_id: string | null;
  start_time: string | null;
}

export type SourceGraphNodeKind = "document" | "event" | "entity";
export type SourceGraphRelationKind = "contains" | "subevent" | "mentions";

export interface SourceGraphRelation {
  source_id: string;
  source_kind: SourceGraphNodeKind;
  target_id: string;
  target_kind: SourceGraphNodeKind;
  kind: SourceGraphRelationKind;
  weight: number;
  description: string;
}

export interface SourceGraphResponse {
  documents: SourceGraphDocument[];
  events: SourceGraphEvent[];
  entities: Entity[];
  relations: SourceGraphRelation[];
  counts: {
    documents: number;
    events: number;
    entities: number;
    shown_documents: number;
    shown_events: number;
    shown_entities: number;
    shown_relations: number;
  };
  truncated: boolean;
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

export interface SearchEvent extends SourceGraphEvent {
  source_id: string | null;
  source_name?: string | null;
  score: number;
}

export interface SearchResponse {
  query: string;
  sections: Section[];
  events: SearchEvent[];
  entities: Entity[];
  relations: SourceGraphRelation[];
  stats: Record<string, unknown>;
}

export interface Capabilities {
  llm_configured: boolean;
  llm_model: string;
  context_window?: number;
  embedding_model: string;
  vector_provider: string;
  language: string;
  search_strategy: SearchStrategy;
  document_parser: DocumentParser;
  effective_document_parser: EffectiveDocumentParser;
  mineru_configured: boolean;
  max_upload_mb: number;
  allowed_upload_exts?: string[];
}
