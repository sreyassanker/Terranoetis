import { embeddings } from './embeddings';

const RAG_NAMESPACE = 'knowledge-base';

interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  source: string;
  category: string;
  chunks: KnowledgeChunk[];
  addedAt: number;
}

interface KnowledgeChunk {
  id: string;
  documentId: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

const documents = new Map<string, KnowledgeDocument>();

export async function addToKnowledgeBase(
  title: string,
  content: string,
  source: string,
  category: string,
): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const chunks = await chunkText(id, content);

  documents.set(id, {
    id,
    title,
    content,
    source,
    category,
    chunks,
    addedAt: Date.now(),
  });

  // Store embeddings for semantic search
  for (const chunk of chunks) {
    await embeddings.store({
      key: chunk.id,
      value: JSON.stringify({ text: chunk.text, metadata: chunk.metadata }),
      namespace: RAG_NAMESPACE,
      vector: chunk.embedding,
    });
  }

  return id;
}

export async function searchKnowledgeBase(
  query: string,
  topK: number = 5,
  category?: string,
): Promise<Array<{ documentId: string; title: string; chunk: string; score: number; source: string }>> {
  await embeddings.generate(query); // Prime the embedding cache
  const results = await embeddings.search(query, topK, 0.5, RAG_NAMESPACE);

  const enriched: Array<{ documentId: string; title: string; chunk: string; score: number; source: string }> = [];

  for (const result of results) {
    const docId = result.metadata?.documentId as string || '';
    const doc = documents.get(docId);
    if (doc) {
      if (category && doc.category !== category) continue;
      enriched.push({
        documentId: doc.id,
        title: doc.title,
        chunk: result.text || '',
        score: result.score,
        source: doc.source,
      });
    }
  }

  return enriched;
}

export async function getDocument(id: string): Promise<KnowledgeDocument | null> {
  return documents.get(id) || null;
}

export async function listDocuments(category?: string): Promise<KnowledgeDocument[]> {
  const docs = Array.from(documents.values());
  if (category) return docs.filter(d => d.category === category);
  return docs;
}

export async function removeDocument(id: string): Promise<boolean> {
  const doc = documents.get(id);
  if (!doc) return false;

  for (const chunk of doc.chunks) {
    await embeddings.delete(chunk.id, RAG_NAMESPACE);
  }

  documents.delete(id);
  return true;
}

export async function buildRAGPrompt(
  query: string,
  contextMessages: Array<{ role: string; content: string }>,
): Promise<string> {
  const searchResults = await searchKnowledgeBase(query, 3);

  if (searchResults.length === 0) {
    return query;
  }

  const context = searchResults.map(r =>
    `Source: ${r.title} (${r.source})\n${r.chunk}`,
  ).join('\n\n---\n\n');

  const recentContext = contextMessages.slice(-4).map(m =>
    `${m.role}: ${m.content.slice(0, 500)}`,
  ).join('\n\n');

  return `You are Earth Intelligence AI. Use the following knowledge base context to answer the query. If the knowledge base doesn't have relevant information, use your general knowledge.

=== Knowledge Base Context ===
${context}

=== Recent Conversation ===
${recentContext}

=== Query ===
${query}

Provide a comprehensive answer citing sources where applicable.`;
}

async function chunkText(documentId: string, text: string, chunkSize: number = 500, overlap: number = 50): Promise<KnowledgeChunk[]> {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: KnowledgeChunk[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      const embedding = await embeddings.generate(currentChunk.trim());
      chunks.push({
        id: `${documentId}-chunk-${chunks.length}`,
        documentId,
        text: currentChunk.trim(),
        embedding,
        metadata: { chunkIndex: chunks.length },
      });
      const lastSentence = currentChunk.slice(-overlap);
      currentChunk = lastSentence + sentence;
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk.trim()) {
    const embedding = await embeddings.generate(currentChunk.trim());
    chunks.push({
      id: `${documentId}-chunk-${chunks.length}`,
      documentId,
      text: currentChunk.trim(),
      embedding,
      metadata: { chunkIndex: chunks.length },
    });
  }

  return chunks;
}