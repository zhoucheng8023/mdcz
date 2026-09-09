import type { Configuration } from "@mdcz/shared/config";
import type { LlmApiFormat, LlmOutputFormat, LlmReasoning, LlmServiceType } from "@mdcz/shared/llm";
import {
  isMissingRequiredLlmApiKey,
  type LlmApiClient,
  normalizeLlmBaseUrl,
  toLlmTextRequest,
} from "../scrape/translate/engines/LlmApiClient";
import {
  buildLlmTranslatePrompt,
  cleanTranslationOutput,
  LLM_TEXT_TRANSLATION_SCHEMA,
} from "../scrape/translate/engines/OpenAiTranslator";
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
  const llmModelName =
    typeof input?.llmModelName === "string" ? input.llmModelName : configuration.translate.llmModelName;
  const llmApiKey = typeof input?.llmApiKey === "string" ? input.llmApiKey : configuration.translate.llmApiKey;
  const llmBaseUrl = typeof input?.llmBaseUrl === "string" ? input.llmBaseUrl : configuration.translate.llmBaseUrl;
  const llmPrompt = typeof input?.llmPrompt === "string" ? input.llmPrompt : configuration.translate.llmPrompt;
  const llmTimeout =
    typeof input?.llmTimeout === "number" && Number.isFinite(input.llmTimeout)
      ? input.llmTimeout
      : configuration.translate.llmTimeout;

  if (!llmModelName.trim()) {
    return { success: false, message: "请先填写 LLM 模型名称" };
  }

  if (isMissingRequiredLlmApiKey(llmBaseUrl, llmApiKey)) {
    return { success: false, message: "请先填写 LLM 密钥（默认 OpenAI 地址需要）" };
  }

  const normalizedBaseUrl = normalizeLlmBaseUrl(llmBaseUrl);
  logger?.info(`Test LLM connectivity: model=${llmModelName}, baseURL=${normalizedBaseUrl}`);

  try {
    const outputFormat = input?.llmOutputFormat ?? configuration.translate.llmOutputFormat;
    const structured = outputFormat !== "none";
    const source = "ある日の暮方の事である。";
    const request = toLlmTextRequest(
      {
        llmModelName,
        llmApiKey,
        llmBaseUrl: normalizedBaseUrl,
        llmApiFormat: input?.llmApiFormat ?? configuration.translate.llmApiFormat,
        llmTemperature:
          input?.llmTemperature !== undefined ? input.llmTemperature : configuration.translate.llmTemperature,
        llmReasoning: input?.llmReasoning ?? configuration.translate.llmReasoning,
        llmServiceType: input?.llmServiceType ?? configuration.translate.llmServiceType,
        llmOutputFormat: outputFormat,
        llmTimeout: Math.max(1, Math.trunc(llmTimeout)),
      },
      buildLlmTranslatePrompt(llmPrompt, source, toTarget(configuration.translate.targetLanguage), structured),
      structured ? LLM_TEXT_TRANSLATION_SCHEMA : undefined,
    );
    const content = await llmApiClient.generateText(request);
    if (!content) return { success: false, message: "LLM 返回空内容" };
    const translation = cleanTranslationOutput(content, llmPrompt, source, structured);

    if (translation) {
      logger?.info("Test LLM connectivity: Success");
      return { success: true, message: `连接成功，LLM 回复: ${translation}` };
    }

    return { success: false, message: "LLM 返回内容不符合翻译输出格式" };
  } catch (error) {
    const message = toErrorMessage(error);
    logger?.error(`Test LLM connectivity: Failed, error=${message}`);
    return { success: false, message: `连接失败: ${message}` };
  }
};
