-- Vector similarity search function for companion memory
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding VECTOR(1536),
  match_user_id UUID,
  match_count INT DEFAULT 10,
  match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  memory_type TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cm.id,
    cm.content,
    cm.memory_type,
    1 - (cm.embedding <=> query_embedding) AS similarity
  FROM companion_memory cm
  WHERE cm.user_id = match_user_id
    AND 1 - (cm.embedding <=> query_embedding) > match_threshold
  ORDER BY cm.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
