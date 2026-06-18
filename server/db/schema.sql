-- Realtime_v2 SQLite Schema v1
-- WAL mode + busy_timeout=5000 set at connection level

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  last_login_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  favorite_layers TEXT NOT NULL DEFAULT '[]',
  frequent_locations TEXT NOT NULL DEFAULT '[]',
  recent_queries TEXT NOT NULL DEFAULT '[]',
  model_preference TEXT NOT NULL DEFAULT 'gemini',
  alert_thresholds TEXT NOT NULL DEFAULT '{"earthquake":6,"storm":80,"fire":200}',
  layer_toggle_count TEXT NOT NULL DEFAULT '{}',
  json_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  episode_id TEXT NOT NULL UNIQUE,
  query TEXT NOT NULL,
  response TEXT NOT NULL DEFAULT '',
  intent_type TEXT NOT NULL DEFAULT 'unknown',
  location_lat REAL,
  location_lon REAL,
  location_label TEXT,
  layers_toggled TEXT NOT NULL DEFAULT '[]',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  cached INTEGER NOT NULL DEFAULT 0,
  model_tier TEXT NOT NULL DEFAULT 'flash',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_episodes_user_id ON episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_episodes_created_at ON episodes(created_at);
CREATE INDEX IF NOT EXISTS idx_episodes_user_created ON episodes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS monitor_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL DEFAULT '',
  layer_id TEXT NOT NULL,
  condition_json TEXT NOT NULL,
  location_json TEXT,
  label TEXT NOT NULL,
  interval_ms INTEGER NOT NULL DEFAULT 300000,
  last_triggered_at TEXT,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monitor_rules_user_id ON monitor_rules(user_id);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  goal TEXT NOT NULL,
  interval_ms INTEGER NOT NULL DEFAULT 86400000,
  last_run_at TEXT,
  next_run_at TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL DEFAULT '',
  response TEXT NOT NULL DEFAULT '',
  vote TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  intent_type TEXT NOT NULL DEFAULT 'unknown',
  model_tier TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_intent_type ON feedback(intent_type);
CREATE INDEX IF NOT EXISTS idx_feedback_model_tier ON feedback(model_tier);

CREATE TABLE IF NOT EXISTS cache_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_hash TEXT NOT NULL UNIQUE,
  query TEXT NOT NULL,
  response_json TEXT NOT NULL,
  embedding BLOB,
  hit_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cache_entries_expires ON cache_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_entries_query_hash ON cache_entries(query_hash);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'local-user',
  title TEXT NOT NULL DEFAULT 'Untitled Chat',
  messages_json TEXT NOT NULL DEFAULT '[]',
  environment_id TEXT,
  workspace_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_environment ON chats(environment_id);
CREATE INDEX IF NOT EXISTS idx_chats_workspace ON chats(workspace_id);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  fact_text TEXT NOT NULL,
  embedding BLOB,
  source_episode_id TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_facts_user_id ON facts(user_id);
CREATE INDEX IF NOT EXISTS idx_facts_source_episode ON facts(source_episode_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  resource TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC);

-- VecStore: vector embeddings for semantic search
CREATE TABLE IF NOT EXISTS vec_store (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vec_store_type_id ON vec_store(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_vec_store_user_id ON vec_store(user_id);

-- Procedural memory: successful tool call patterns
CREATE TABLE IF NOT EXISTS procedural_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  intent_type TEXT NOT NULL,
  pattern_json TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_proc_patterns_intent ON procedural_patterns(intent_type);

-- ML Pipeline: eval scores for automated response evaluation
CREATE TABLE IF NOT EXISTS eval_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id TEXT,
  query TEXT NOT NULL,
  relevance REAL NOT NULL DEFAULT 0.5,
  factual_accuracy REAL NOT NULL DEFAULT 0.5,
  helpfulness REAL NOT NULL DEFAULT 0.5,
  conciseness REAL NOT NULL DEFAULT 0.5,
  overall REAL NOT NULL DEFAULT 0.5,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eval_scores_created ON eval_scores(created_at DESC);

-- ML Pipeline: synthetic training data generated by LLM
CREATE TABLE IF NOT EXISTS synthetic_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  response TEXT NOT NULL,
  intent_type TEXT NOT NULL DEFAULT 'general',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_synthetic_intent ON synthetic_data(intent_type);

-- ML Pipeline: knowledge graph entities
CREATE TABLE IF NOT EXISTS knowledge_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'entity',
  embedding BLOB,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_entities_type ON knowledge_entities(type);

-- ML Pipeline: knowledge graph relations
CREATE TABLE IF NOT EXISTS knowledge_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES knowledge_entities(id),
  target_id INTEGER NOT NULL REFERENCES knowledge_entities(id),
  relation_type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_relations_source ON knowledge_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_target ON knowledge_relations(target_id);

-- ML Pipeline: historical patterns for predictive analytics
CREATE TABLE IF NOT EXISTS historical_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT,
  pattern TEXT NOT NULL,
  outcome TEXT NOT NULL,
  accuracy REAL NOT NULL DEFAULT 0.5,
  occurrences INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pattern, outcome)
);

CREATE INDEX IF NOT EXISTS idx_historical_patterns_outcome ON historical_patterns(outcome);

-- ML Pipeline: prediction log for tracking prediction accuracy
CREATE TABLE IF NOT EXISTS prediction_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hazard_type TEXT NOT NULL,
  probability REAL NOT NULL,
  severity TEXT NOT NULL,
  accuracy REAL NOT NULL,
  features_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prediction_log_hazard ON prediction_log(hazard_type);
CREATE INDEX IF NOT EXISTS idx_prediction_log_created ON prediction_log(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- World Model: Causal World Model for Physics-Informed Predictions
-- ═══════════════════════════════════════════════════════════════════════

-- Causal graph nodes (events, conditions, hazards)
CREATE TABLE IF NOT EXISTS causal_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  prior REAL NOT NULL DEFAULT 0.5,
  embedding BLOB,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_causal_nodes_name ON causal_nodes(name);
CREATE INDEX IF NOT EXISTS idx_causal_nodes_type ON causal_nodes(type);

-- Causal graph edges (causal relationships between nodes)
CREATE TABLE IF NOT EXISTS causal_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES causal_nodes(id),
  target_id INTEGER NOT NULL REFERENCES causal_nodes(id),
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.5,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_causal_edges_source ON causal_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_causal_edges_target ON causal_edges(target_id);

-- Prediction validation log (for Brier score, calibration, ROC-AUC)
CREATE TABLE IF NOT EXISTS validation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hazard_type TEXT NOT NULL,
  predicted_prob REAL NOT NULL,
  actual_occurred INTEGER NOT NULL,
  predicted_severity TEXT NOT NULL DEFAULT 'low',
  actual_severity TEXT NOT NULL DEFAULT 'unknown',
  model_used TEXT NOT NULL DEFAULT 'ensemble',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_val_hazard ON validation_log(hazard_type);
CREATE INDEX IF NOT EXISTS idx_val_created ON validation_log(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- Memory V2: Hierarchical Cognitive Memory Tables
-- ═══════════════════════════════════════════════════════════════════════

-- Sensory Buffer: ring buffer of last 1000 perceptual events
CREATE TABLE IF NOT EXISTS sensory_buffer (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  data TEXT NOT NULL,
  importance_score REAL NOT NULL DEFAULT 0,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sensory_timestamp ON sensory_buffer(timestamp);
CREATE INDEX IF NOT EXISTS idx_sensory_importance ON sensory_buffer(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_sensory_type ON sensory_buffer(type);

-- Working Memory: current session context (active goal, recent messages, pending tasks)
CREATE TABLE IF NOT EXISTS working_memory (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  relevance REAL NOT NULL DEFAULT 0.5,
  parent_id TEXT,
  active_goal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_working_timestamp ON working_memory(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_working_type ON working_memory(type);

-- Episodic Memory V2: rich interaction episodes with vector search + consolidation
CREATE TABLE IF NOT EXISTS episodic_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL,
  response TEXT NOT NULL DEFAULT '',
  intent_type TEXT NOT NULL DEFAULT 'unknown',
  tags_json TEXT NOT NULL DEFAULT '[]',
  location_lat REAL,
  location_lon REAL,
  location_label TEXT,
  layers_toggled TEXT NOT NULL DEFAULT '[]',
  emotional_valence REAL NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'unknown',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  model_tier TEXT NOT NULL DEFAULT 'flash',
  embedding BLOB,
  consolidated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_episodic_v2_user ON episodic_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_episodic_v2_intent ON episodic_v2(intent_type);
CREATE INDEX IF NOT EXISTS idx_episodic_v2_created ON episodic_v2(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodic_v2_outcome ON episodic_v2(outcome);
CREATE INDEX IF NOT EXISTS idx_episodic_v2_consolidated ON episodic_v2(consolidated);

-- Semantic Memory: knowledge graph + vector store hybrid
CREATE TABLE IF NOT EXISTS semantic_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'entity',
  embedding BLOB,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_semantic_entities_type ON semantic_entities(type);
CREATE INDEX IF NOT EXISTS idx_semantic_entities_name ON semantic_entities(name);

CREATE TABLE IF NOT EXISTS semantic_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES semantic_entities(id),
  target_id INTEGER NOT NULL REFERENCES semantic_entities(id),
  relation_type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_semantic_rel_source ON semantic_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_semantic_rel_target ON semantic_relations(target_id);
CREATE INDEX IF NOT EXISTS idx_semantic_rel_type ON semantic_relations(relation_type);

-- Procedural Memory V2: reusable tool chain templates with auto-abstraction
CREATE TABLE IF NOT EXISTS procedural_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_condition TEXT NOT NULL,
  tool_chain_json TEXT NOT NULL,
  success_rate REAL NOT NULL DEFAULT 1.0,
  avg_latency REAL NOT NULL DEFAULT 0,
  last_used TEXT NOT NULL DEFAULT (datetime('now')),
  usage_count INTEGER NOT NULL DEFAULT 1,
  abstracted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_procedural_v2_trigger ON procedural_v2(trigger_condition);
CREATE INDEX IF NOT EXISTS idx_procedural_v2_success ON procedural_v2(success_rate DESC);

-- Predictive Memory: forecast models with accuracy tracking
CREATE TABLE IF NOT EXISTS predictive_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_type TEXT NOT NULL,
  parameters_json TEXT NOT NULL DEFAULT '{}',
  training_data_desc TEXT NOT NULL DEFAULT '',
  accuracy_history TEXT NOT NULL DEFAULT '[]',
  avg_accuracy REAL NOT NULL DEFAULT 0.5,
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  training_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_predictive_models_type ON predictive_models(model_type);
CREATE INDEX IF NOT EXISTS idx_predictive_models_active ON predictive_models(active);

-- Prediction Log V2: individual prediction records with actual outcome tracking
CREATE TABLE IF NOT EXISTS prediction_log_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL REFERENCES predictive_models(id),
  hazard_type TEXT NOT NULL,
  probability REAL NOT NULL,
  severity TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  actual_outcome TEXT,
  features_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prediction_v2_model ON prediction_log_v2(model_id);
CREATE INDEX IF NOT EXISTS idx_prediction_v2_hazard ON prediction_log_v2(hazard_type);
CREATE INDEX IF NOT EXISTS idx_prediction_v2_created ON prediction_log_v2(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_v2_outcome ON prediction_log_v2(actual_outcome);

-- ═══════════════════════════════════════════════════════════════════════
-- Tools V2: Dynamic Tool System
-- ═══════════════════════════════════════════════════════════════════════

-- Dynamic tool registry: core tools + LLM-generated + discovered tools
CREATE TABLE IF NOT EXISTS dynamic_tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  example_queries TEXT NOT NULL DEFAULT '[]',
  schema_json TEXT NOT NULL,
  code TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  health_status TEXT NOT NULL DEFAULT 'unknown',
  source TEXT NOT NULL DEFAULT 'core',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tool version history for rollback support
CREATE TABLE IF NOT EXISTS tool_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  code TEXT,
  schema_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tool_name, version)
);

-- Composed tool chains
CREATE TABLE IF NOT EXISTS tool_chains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  steps_json TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Executor execution log
CREATE TABLE IF NOT EXISTS execution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT NOT NULL DEFAULT '{}',
  success INTEGER NOT NULL DEFAULT 0,
  error_msg TEXT,
  fallback_type TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_execution_log_tool ON execution_log(tool_name);
CREATE INDEX IF NOT EXISTS idx_execution_log_created ON execution_log(created_at DESC);

-- Sentinel anomaly detection log
CREATE TABLE IF NOT EXISTS sentinel_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anomaly_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  method TEXT NOT NULL,
  score REAL NOT NULL,
  confidence REAL NOT NULL,
  description TEXT,
  lat REAL,
  lon REAL,
  event_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sentinel_anomalies_type ON sentinel_anomalies(type);
CREATE INDEX IF NOT EXISTS idx_sentinel_anomalies_created ON sentinel_anomalies(created_at DESC);

-- Sentinel alerts issued to users
CREATE TABLE IF NOT EXISTS sentinel_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id TEXT NOT NULL UNIQUE,
  anomaly_id TEXT,
  user_id TEXT,
  title TEXT,
  body TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  lat REAL,
  lon REAL,
  type TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sentinel_alerts_user ON sentinel_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_sentinel_alerts_severity ON sentinel_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_sentinel_alerts_created ON sentinel_alerts(created_at DESC);

-- Fork simulations
CREATE TABLE IF NOT EXISTS forks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fork_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'anonymous',
  baseline_snapshot TEXT NOT NULL DEFAULT '{}',
  deltas_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'running',
  divergence_score REAL NOT NULL DEFAULT 0.0,
  simulated_time_ms INTEGER NOT NULL DEFAULT 0,
  max_simulation_hours INTEGER NOT NULL DEFAULT 72,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  terminated_at TEXT,
  termination_reason TEXT
);

-- Causal discovery results
CREATE TABLE IF NOT EXISTS discoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discovery_id TEXT NOT NULL UNIQUE,
  edge_rowid INTEGER,
  summary TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  validated_by TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending',
  fork_id TEXT,
  FOREIGN KEY (edge_rowid) REFERENCES causal_edges(id)
);

CREATE INDEX IF NOT EXISTS idx_discoveries_status ON discoveries(validation_status);
CREATE INDEX IF NOT EXISTS idx_discoveries_fork ON discoveries(fork_id);
CREATE INDEX IF NOT EXISTS idx_discoveries_validated_by ON discoveries(validated_by);

-- Discovered API sources
CREATE TABLE IF NOT EXISTS discovered_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_health_check INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Synthetic events (Dream Engine)
CREATE TABLE IF NOT EXISTS synthetic_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  scenario_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  lat REAL,
  lon REAL,
  radius_km REAL,
  magnitude REAL NOT NULL,
  parameters_json TEXT DEFAULT '{}',
  is_real INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (scenario_id) REFERENCES synthetic_scenarios(scenario_id)
);

CREATE TABLE IF NOT EXISTS synthetic_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  events_json TEXT DEFAULT '[]',
  fork_id TEXT,
  predicted_outcome TEXT,
  actual_outcome TEXT,
  prediction_accuracy REAL,
  evaluated_at TEXT,
  lessons_learned_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dream_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dream_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  scenarios_run INTEGER NOT NULL DEFAULT 0,
  scenarios_json TEXT DEFAULT '[]',
  model_updates_json TEXT DEFAULT '[]',
  new_causal_edges_json TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_synthetic_events_scenario ON synthetic_events(scenario_id);
CREATE INDEX IF NOT EXISTS idx_synthetic_scenarios_fork ON synthetic_scenarios(fork_id);

-- Memory Architecture v3: Planetary Memory Store
CREATE TABLE IF NOT EXISTS memory_store (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  content_json TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tier, memory_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_tier_id ON memory_store(tier, memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_store(importance DESC);
