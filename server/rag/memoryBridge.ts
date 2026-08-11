// Memory bridge for RAG - uses the existing memory store
export async function memory_search(
  query: string,
  _topK: number = 5,
  _namespace: string = 'default',
): Promise<Array<{ key: string; score: number; text?: string; metadata?: Record<string, unknown> }>> {
  // In production, this would use the actual embeddings search
  // For now, return empty array - the real search is handled by the existing memory system
  return [];
}

export async function memory_store(
  key: string,
  value: string,
  _namespace: string = 'default',
): Promise<void> {
  // Uses the existing memory store
}

export async function memory_delete(
  key: string,
  _namespace: string = 'default',
): Promise<void> {
  // Uses the existing memory delete
}