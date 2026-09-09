import type { Configuration } from "@mdcz/shared/config";
import type { LlmApiFormat, LlmOutputFormat, LlmReasoning, LlmServiceType } from "@mdcz/shared/llm";
import {
  isMissingRequiredLlmApiKey,
  type LlmApiClient,
  normalizeLlmBaseUrl,
} from "../scrape/translate/engines/LlmApiClient";
import { OpenAiTranslator } from "../scrape/translate/engines/OpenAiTranslator";
import { toTarget } from "../scrape/translate/types";
import type { RuntimeLogger } from "../shared";
import { toErrorMessage } from "../shared";

export interface TranslateTestLlmInput {
  llmModelName?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmApiFormat?: LlmApiFormat;
  llmServiceType?: LlmServiceType;
  llmPrompt?: string;
  llmTemperature?: number | null;
  llmReasoning?: LlmReasoning;
  llmOutputFormat?: LlmOutputFormat;
  llmTimeout?: number;
}

export interface TranslateTestLlmResult {
  success: boolean;
  message: string;
}

export const testLlmConnectivity = async (
  input: TranslateTestLlmInput | undefined,
  configuration: Configuration,
  llmApiClient: LlmApiClient,
  logger?: Pick<RuntimeLogger, "error" | "info">,
): Promise<TranslateTestLlmResult> => {
  const config: Configuration = {
    ...configuration,
    translate: {
      ...configuration.translate,
      ...Object.fromEntries(Object.entries(input ?? {}).filter(([, value]) => value !== undefined)),
    },
  };
  const { llmModelName, llmApiKey, llmBaseUrl } = config.translate;

  if (!llmModelName.trim()) {
    return { success: false, message: "请先填写 LLM 模型名称" };
  }

  if (isMissingRequiredLlmApiKey(llmBaseUrl, llmApiKey)) {
    return { success: false, message: "请先填写 LLM 密钥（默认 OpenAI 地址需要）" };
  }

  const normalizedBaseUrl = normalizeLlmBaseUrl(llmBaseUrl);
  logger?.info(`Test LLM connectivity: model=${llmModelName}, baseURL=${normalizedBaseUrl}`);

  try {
    const translator = new OpenAiTranslator({ warn: (message) => logger?.info(message) }, llmApiClient);
    const translation = await translator.translateMetadata(
      { title: "ある日の暮方の事である。", plot: null, genres: ["日常"] },
      toTarget(config.translate.targetLanguage),
      config,
    );
    logger?.info("Test LLM connectivity: Success");
    return { success: true, message: `元数据翻译样本验证通过：${translation.title}` };
  } catch (error) {
    const message = toErrorMessage(error);
    logger?.error(`Test LLM connectivity: Failed, error=${message}`);
    return { success: false, message: `连接失败: ${message}` };
  }
};
