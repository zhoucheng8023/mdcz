export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";

export const LLM_REASONING_EFFORT_OPTIONS = ["low", "medium", "high"] as const;
export type LlmReasoningEffort = (typeof LLM_REASONING_EFFORT_OPTIONS)[number];
