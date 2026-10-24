export type Chunk = {
  id: string;
  text: string;
  document: string;
  page: number; // 1-based PDF page number
  section?: string;
  embedding: number[];
};

export type RetrievedChunk = Omit<Chunk, "embedding"> & { score: number; sourceId: string };
