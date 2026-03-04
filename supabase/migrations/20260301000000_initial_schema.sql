-- Enable pgvector extension for companion memory
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- ============================================
-- User profiles (extends Supabase auth.users)
-- ============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  native_language TEXT DEFAULT 'en',
  current_cefr_level TEXT DEFAULT 'A1' CHECK (current_cefr_level IN ('A1','A2','B1','B2','C1','C2')),
  target_cefr_level TEXT DEFAULT 'C1' CHECK (target_cefr_level IN ('A1','A2','B1','B2','C1','C2')),
  daily_goal_minutes INTEGER DEFAULT 15,
  streak_days INTEGER DEFAULT 0,
  last_active_date DATE,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- Per-skill CEFR tracking (5 TCF skills)
-- ============================================
CREATE TABLE skill_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill TEXT NOT NULL CHECK (skill IN ('listening','reading','speaking','writing','grammar')),
  cefr_level TEXT DEFAULT 'A1',
  score FLOAT DEFAULT 0,
  exercises_completed INTEGER DEFAULT 0,
  total_time_minutes INTEGER DEFAULT 0,
  last_practiced TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, skill)
);

ALTER TABLE skill_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own skill progress" ON skill_progress
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- Conversation sessions (voice practice)
-- ============================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  scenario_description TEXT,
  cefr_level TEXT NOT NULL,
  mode TEXT DEFAULT 'companion' CHECK (mode IN ('companion','debate','tcf_simulation')),
  duration_seconds INTEGER DEFAULT 0,
  ai_feedback JSONB,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own conversations" ON conversations
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- Conversation messages (text transcript)
-- ============================================
CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  audio_storage_path TEXT,
  corrections JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own conversation messages" ON conversation_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_messages.conversation_id
      AND c.user_id = auth.uid()
    )
  );

-- ============================================
-- Exercises (listening, reading, writing, grammar)
-- ============================================
CREATE TABLE exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill TEXT NOT NULL CHECK (skill IN ('listening','reading','writing','grammar')),
  cefr_level TEXT NOT NULL,
  exercise_type TEXT NOT NULL,
  content JSONB NOT NULL,
  user_answer JSONB,
  ai_evaluation JSONB,
  score FLOAT,
  completed BOOLEAN DEFAULT FALSE,
  time_spent_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own exercises" ON exercises
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- Vocabulary bank (spaced repetition)
-- ============================================
CREATE TABLE vocabulary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  french_word TEXT NOT NULL,
  english_translation TEXT NOT NULL,
  context_sentence TEXT,
  cefr_level TEXT NOT NULL,
  phonetic TEXT,
  ease_factor FLOAT DEFAULT 2.5,
  interval_days INTEGER DEFAULT 1,
  repetitions INTEGER DEFAULT 0,
  next_review TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, french_word)
);

ALTER TABLE vocabulary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own vocabulary" ON vocabulary
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- TCF Mock test sessions
-- ============================================
CREATE TABLE mock_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  test_type TEXT NOT NULL CHECK (test_type IN ('full','listening','reading','grammar','speaking','writing')),
  total_score INTEGER,
  section_scores JSONB,
  cefr_result TEXT,
  duration_seconds INTEGER,
  questions JSONB NOT NULL,
  status TEXT DEFAULT 'in_progress',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE mock_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own mock tests" ON mock_tests
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- Daily activity log (streaks + analytics)
-- ============================================
CREATE TABLE daily_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  minutes_practiced INTEGER DEFAULT 0,
  exercises_completed INTEGER DEFAULT 0,
  conversations_completed INTEGER DEFAULT 0,
  words_learned INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

ALTER TABLE daily_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own daily activity" ON daily_activity
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- Companion memory (long-term RAG with pgvector)
-- ============================================
CREATE TABLE companion_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  memory_type TEXT CHECK (memory_type IN ('personal_fact','preference','topic_discussed','milestone')),
  source_conversation_id UUID REFERENCES conversations(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON companion_memory USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE companion_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own companion memory" ON companion_memory
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- Error patterns (persistent mistake tracking)
-- ============================================
CREATE TABLE error_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  error_type TEXT NOT NULL CHECK (error_type IN ('grammar','pronunciation','vocabulary','register')),
  error_description TEXT NOT NULL,
  occurrences INTEGER DEFAULT 1,
  last_occurred TIMESTAMPTZ DEFAULT NOW(),
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE error_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own error patterns" ON error_patterns
  FOR ALL USING (auth.uid() = user_id);
