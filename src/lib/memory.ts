import { supabase } from "./supabase";
import { chatCompletionJSON, generateEmbedding } from "./openai";

/** Memory types stored in companion_memory table */
export type MemoryType = "personal_fact" | "preference" | "topic_discussed" | "milestone";

interface MemoryRecord {
  id: string;
  content: string;
  memory_type: MemoryType;
  created_at: string;
}

interface ExtractedFact {
  content: string;
  type: MemoryType;
}

/**
 * Extract key facts from a conversation transcript using AI,
 * then store them as vector embeddings for future retrieval.
 */
export async function extractAndStoreMemories(
  userId: string,
  conversationId: string,
  transcript: string
): Promise<void> {
  // Ask AI to extract memorable facts
  const facts = await chatCompletionJSON<{ facts: ExtractedFact[] }>(
    [
      {
        role: "system",
        content: `Extract key personal facts, preferences, and notable topics from this French conversation transcript. Only extract facts about the USER (not the AI). Return JSON.

Categories:
- personal_fact: Name, family, job, city, pets, hobbies, age, nationality
- preference: Likes, dislikes, interests, opinions they expressed
- topic_discussed: Notable topics or themes they engaged with
- milestone: Learning achievements mentioned (e.g., "passed B1 exam", "first trip to Paris")

Rules:
- Keep each fact concise (1 sentence max)
- Write facts in English for storage clarity
- Only extract genuinely useful facts for future conversations
- Return empty array if nothing notable was shared

Response format: {"facts": [{"content": "...", "type": "..."}]}`,
      },
      {
        role: "user",
        content: transcript,
      },
    ],
    { temperature: 0.3 }
  );

  if (!facts.facts || facts.facts.length === 0) return;

  // Generate embeddings in parallel using Promise.allSettled
  const embeddingResults = await Promise.allSettled(
    facts.facts.map((fact) => generateEmbedding(fact.content))
  );

  // Collect successfully embedded memories into a batch for a single insert
  const memoryRows: {
    user_id: string;
    content: string;
    embedding: string;
    memory_type: MemoryType;
    source_conversation_id: string;
  }[] = [];

  for (let i = 0; i < facts.facts.length; i++) {
    const embeddingResult = embeddingResults[i];
    if (embeddingResult.status === "rejected") {
      console.error(
        `Failed to generate embedding for fact "${facts.facts[i].content}":`,
        embeddingResult.reason instanceof Error
          ? embeddingResult.reason.message
          : String(embeddingResult.reason)
      );
      continue;
    }

    memoryRows.push({
      user_id: userId,
      content: facts.facts[i].content,
      embedding: JSON.stringify(embeddingResult.value),
      memory_type: facts.facts[i].type,
      source_conversation_id: conversationId,
    });
  }

  if (memoryRows.length === 0) return;

  // Batch insert all memories in a single Supabase call
  const { error } = await supabase.from("companion_memory").insert(memoryRows);

  if (error) {
    console.error(`Failed to batch-insert memories: ${error.message}`);
  }
}

/**
 * Retrieve relevant memories for a new conversation using vector similarity.
 * Returns memories most relevant to the given topic/context.
 */
export async function retrieveMemories(
  userId: string,
  context: string,
  limit: number = 10
): Promise<string[]> {
  const queryEmbedding = await generateEmbedding(context);

  // Use Supabase RPC to perform vector similarity search
  const { data, error } = await supabase.rpc("match_memories", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: limit,
    match_threshold: 0.7,
  });

  if (error || !data) {
    // Fallback: fetch recent memories without vector search
    return fetchRecentMemories(userId, limit);
  }

  return data.map((m: { content: string }) => m.content);
}

/** Fallback: fetch most recent memories for a user */
async function fetchRecentMemories(userId: string, limit: number): Promise<string[]> {
  const { data } = await supabase
    .from("companion_memory")
    .select("content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return data?.map((m) => m.content) ?? [];
}

/**
 * Delete a specific memory (e.g., if the user asks to forget something).
 */
export async function deleteMemory(memoryId: string): Promise<void> {
  const { error } = await supabase.from("companion_memory").delete().eq("id", memoryId);

  if (error) {
    throw new Error(`Failed to delete memory: ${error.message}`);
  }
}

/**
 * Get all memories for a user, grouped by type.
 */
export async function getAllMemories(userId: string): Promise<Record<MemoryType, MemoryRecord[]>> {
  const { data } = await supabase
    .from("companion_memory")
    .select("id, content, memory_type, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const grouped: Record<MemoryType, MemoryRecord[]> = {
    personal_fact: [],
    preference: [],
    topic_discussed: [],
    milestone: [],
  };

  for (const item of data ?? []) {
    const type = item.memory_type as MemoryType;
    if (grouped[type]) {
      grouped[type].push(item as MemoryRecord);
    }
  }

  return grouped;
}
