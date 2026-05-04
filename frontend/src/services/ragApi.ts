/**
 * ragApi.ts – typed client for the HestIA RAG chat endpoint.
 */
import api from "./api";

export interface RagChatResponse {
  answer: string;
  sources: { source_file: string; score: number }[];
  confidence: number;
  suggested_question: string;
}

export const ragApi = {
  async chat(message: string): Promise<RagChatResponse> {
    const res = await api.post("/rag/chat/", { message });
    return res.data;
  },
};
