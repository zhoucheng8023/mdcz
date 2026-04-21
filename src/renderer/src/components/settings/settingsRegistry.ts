/**
 * Pure data + utilities for the settings form. Extracted from
 * `settingsContent.tsx` so hooks (`useAutoSaveField`, `useCrossFieldErrors`)
 * can import them without pulling in React section renderers and creating a
 * circular dependency with `components/config-form/FieldRenderer.tsx`.
 */

// ── Field registry for search/filter ──

export interface FieldEntry {
  key: string;
  /** Display label (Chinese). */
  label: string;
  /** Top-level anchor section the field belongs to in the new IA. */
  anchor: "dataSources" | "rateLimiting" | "extractionRules" | "paths" | "system";
}

export const FIELD_REGISTRY: FieldEntry[] = [
  // paths
  { key: "paths.mediaPath", label: "媒体目录", anchor: "paths" },
  { key: "paths.actorPhotoFolder", label: "演员头像库目录", anchor: "paths" },
  { key: "paths.softlinkPath", label: "软链接目录", anchor: "paths" },
  { key: "paths.successOutputFolder", label: "成功输出目录", anchor: "paths" },
  { key: "paths.failedOutputFolder", label: "失败输出目录", anchor: "paths" },
  { key: "paths.outputSummaryPath", label: "概览统计目录", anchor: "paths" },
  { key: "paths.sceneImagesFolder", label: "剧照目录名", anchor: "paths" },
  { key: "paths.configDirectory", label: "配置文件目录", anchor: "paths" },
  // scrape — sites live in Data Sources
  { key: "scrape.sites", label: "启用站点与优先级", anchor: "dataSources" },
  // scrape — pacing lives in Rate Limiting
  { key: "scrape.threadNumber", label: "并发线程数", anchor: "rateLimiting" },
  { key: "scrape.javdbDelaySeconds", label: "JavDB 请求延迟(秒)", anchor: "rateLimiting" },
  { key: "scrape.restAfterCount", label: "连续刮削后休息(条数)", anchor: "rateLimiting" },
  { key: "scrape.restDuration", label: "休息时长", anchor: "rateLimiting" },
  // network — connection in Rate Limiting
  { key: "network.proxyType", label: "代理类型", anchor: "rateLimiting" },
  { key: "network.proxy", label: "代理地址", anchor: "rateLimiting" },
  { key: "network.useProxy", label: "启用代理", anchor: "rateLimiting" },
  { key: "network.timeout", label: "超时时间(秒)", anchor: "rateLimiting" },
  { key: "network.retryCount", label: "重试次数", anchor: "rateLimiting" },
  // network — site cookies in Data Sources
  { key: "network.javdbCookie", label: "JavDB 凭证", anchor: "dataSources" },
  { key: "network.javbusCookie", label: "JavBus 凭证", anchor: "dataSources" },
  // download
  { key: "download.downloadThumb", label: "下载横版缩略图", anchor: "extractionRules" },
  { key: "download.downloadPoster", label: "下载海报", anchor: "extractionRules" },
  { key: "download.tagBadges", label: "封面标签角标", anchor: "extractionRules" },
  { key: "download.downloadFanart", label: "下载背景图", anchor: "extractionRules" },
  { key: "download.downloadSceneImages", label: "下载剧照", anchor: "extractionRules" },
  { key: "download.downloadTrailer", label: "下载预告片", anchor: "extractionRules" },
  { key: "download.generateNfo", label: "生成 NFO", anchor: "extractionRules" },
  { key: "download.nfoNaming", label: "NFO 文件命名", anchor: "extractionRules" },
  { key: "download.keepThumb", label: "保留已有横版缩略图", anchor: "extractionRules" },
  { key: "download.keepPoster", label: "保留已有海报", anchor: "extractionRules" },
  { key: "download.keepFanart", label: "保留已有背景图", anchor: "extractionRules" },
  { key: "download.keepSceneImages", label: "保留已有剧照", anchor: "extractionRules" },
  { key: "download.keepTrailer", label: "保留已有预告片", anchor: "extractionRules" },
  { key: "download.keepNfo", label: "保留已有 NFO", anchor: "extractionRules" },
  // naming
  { key: "naming.folderTemplate", label: "文件夹模板", anchor: "extractionRules" },
  { key: "naming.fileTemplate", label: "文件名模板", anchor: "extractionRules" },
  { key: "naming.assetNamingMode", label: "附属文件命名", anchor: "extractionRules" },
  { key: "naming.nfoTitleTemplate", label: "NFO 标题模板", anchor: "extractionRules" },
  { key: "naming.actorNameMax", label: "演员名最大数量", anchor: "extractionRules" },
  { key: "naming.actorNameMore", label: "演员名超出后缀", anchor: "extractionRules" },
  { key: "naming.actorFallbackToStudio", label: "演员为空时使用片商或卖家", anchor: "extractionRules" },
  { key: "naming.releaseRule", label: "发行日期格式", anchor: "extractionRules" },
  { key: "naming.folderNameMax", label: "文件夹名最大长度", anchor: "extractionRules" },
  { key: "naming.fileNameMax", label: "文件名最大长度", anchor: "extractionRules" },
  { key: "naming.cnwordStyle", label: "中文字幕标记", anchor: "extractionRules" },
  { key: "naming.umrStyle", label: "UMR 标记", anchor: "extractionRules" },
  { key: "naming.leakStyle", label: "流出标记", anchor: "extractionRules" },
  { key: "naming.uncensoredStyle", label: "无码标记", anchor: "extractionRules" },
  { key: "naming.censoredStyle", label: "有码标记", anchor: "extractionRules" },
  { key: "naming.partStyle", label: "分盘样式", anchor: "extractionRules" },
  // translate
  { key: "translate.enableTranslation", label: "启用内容翻译", anchor: "dataSources" },
  { key: "translate.engine", label: "翻译引擎", anchor: "dataSources" },
  { key: "translate.llmModelName", label: "LLM 模型名称", anchor: "dataSources" },
  { key: "translate.llmApiKey", label: "LLM 密钥", anchor: "dataSources" },
  { key: "translate.llmBaseUrl", label: "LLM API 地址", anchor: "dataSources" },
  { key: "translate.llmPrompt", label: "LLM 翻译提示词", anchor: "dataSources" },
  { key: "translate.llmTemperature", label: "LLM 温度", anchor: "dataSources" },
  { key: "translate.llmMaxRetries", label: "LLM 最大重试次数", anchor: "dataSources" },
  { key: "translate.llmMaxRequestsPerSecond", label: "LLM 每秒最大请求数", anchor: "dataSources" },
  { key: "translate.targetLanguage", label: "目标语言", anchor: "dataSources" },
  // personSync
  { key: "personSync.personOverviewSources", label: "人物简介来源顺序", anchor: "dataSources" },
  { key: "personSync.personImageSources", label: "人物头像来源顺序", anchor: "dataSources" },
  // jellyfin
  { key: "jellyfin.url", label: "Jellyfin 服务器地址", anchor: "dataSources" },
  { key: "jellyfin.apiKey", label: "Jellyfin API Key", anchor: "dataSources" },
  { key: "jellyfin.userId", label: "Jellyfin 用户 ID", anchor: "dataSources" },
  { key: "jellyfin.refreshPersonAfterSync", label: "同步后刷新人物 (Jellyfin)", anchor: "dataSources" },
  { key: "jellyfin.lockOverviewAfterSync", label: "同步后锁定人物简介 (Jellyfin)", anchor: "dataSources" },
  // emby
  { key: "emby.url", label: "Emby 服务器地址", anchor: "dataSources" },
  { key: "emby.apiKey", label: "Emby API Key", anchor: "dataSources" },
  { key: "emby.userId", label: "Emby 用户 ID", anchor: "dataSources" },
  { key: "emby.refreshPersonAfterSync", label: "同步后刷新人物 (Emby)", anchor: "dataSources" },
  // shortcuts
  { key: "shortcuts.startOrStopScrape", label: "开始/停止刮削", anchor: "system" },
  { key: "shortcuts.retryScrape", label: "重新刮削", anchor: "system" },
  { key: "shortcuts.deleteFile", label: "删除文件", anchor: "system" },
  { key: "shortcuts.deleteFileAndFolder", label: "删除文件及文件夹", anchor: "system" },
  { key: "shortcuts.openFolder", label: "打开所在目录", anchor: "system" },
  { key: "shortcuts.editNfo", label: "编辑 NFO", anchor: "system" },
  { key: "shortcuts.playVideo", label: "播放视频", anchor: "system" },
  // ui
  { key: "ui.showLogsPanel", label: "显示日志面板", anchor: "system" },
  { key: "ui.useCustomTitleBar", label: "使用自定义标题栏", anchor: "system" },
  { key: "ui.hideDock", label: "隐藏 Dock 图标", anchor: "system" },
  { key: "ui.hideMenu", label: "隐藏菜单栏", anchor: "system" },
  { key: "ui.hideWindowButtons", label: "隐藏窗口按钮", anchor: "system" },
  // behavior
  { key: "behavior.successFileMove", label: "成功后移动文件", anchor: "system" },
  { key: "behavior.failedFileMove", label: "失败后移动文件", anchor: "system" },
  { key: "behavior.successFileRename", label: "成功后重命名文件", anchor: "system" },
  { key: "behavior.deleteEmptyFolder", label: "删除空文件夹", anchor: "system" },
  { key: "behavior.scrapeSoftlinkPath", label: "刮削软链接目录", anchor: "system" },
  { key: "behavior.saveLog", label: "保存日志到文件", anchor: "system" },
];

export const SECTION_DESCRIPTIONS: Record<FieldEntry["anchor"], string> = {
  dataSources: "刮削站点、翻译、人物同步服务的数据来源与凭证",
  rateLimiting: "并发、延迟、重试、代理等节奏与连接控制",
  extractionRules: "抓取策略、命名模板、资源下载与 NFO",
  paths: "媒体库、头像库、输出与配置目录",
  system: "界面、快捷键、刮削后的文件行为",
};

export const SECTION_LABELS: Record<FieldEntry["anchor"], string> = {
  dataSources: "数据源",
  rateLimiting: "速率与限流",
  extractionRules: "提取规则",
  paths: "目录与路径",
  system: "系统",
};

// ── Config value helpers ──

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  const tail = parts.at(-1);
  if (tail) cursor[tail] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function flattenConfig(data: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const entry of FIELD_REGISTRY) {
    flat[entry.key] = getNestedValue(data, entry.key);
  }

  const siteConfigs = getNestedValue(data, "scrape.siteConfigs");
  if (isRecord(siteConfigs)) {
    for (const [site, config] of Object.entries(siteConfigs)) {
      if (!isRecord(config)) {
        continue;
      }
      if ("customUrl" in config) {
        flat[`scrape.siteConfigs.${site}.customUrl`] = config.customUrl;
      }
    }
  }

  return flat;
}

export function unflattenConfig(flat: Record<string, unknown>): Record<string, unknown> {
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (value !== undefined) setNestedValue(nested, key, value);
  }
  return nested;
}

export { getNestedValue, isRecord };
