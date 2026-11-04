import "dotenv/config";

function repoMap(): Record<string, string> {
  try {
    return JSON.parse(process.env.CUSTOMER_REPO_MAP ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export const config = {
  port: Number(process.env.SERVER_PORT ?? 3001),
  host: process.env.HOST ?? "127.0.0.1",
  modelApiKey: process.env.MODEL_API_KEY ?? "",
  model: process.env.MODEL_NAME ?? "muse-spark-1.3",
  modelBaseUrl: process.env.MODEL_BASE_URL ?? "https://api.meta.ai/v1",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  githubOwner: process.env.GITHUB_OWNER ?? "",
  githubRepo: process.env.GITHUB_REPO ?? "",
  whatsappToken: process.env.WHATSAPP_TOKEN ?? "",
  whatsappPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "relais-verify",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET ?? "",
  demoRepo: process.env.DEMO_REPO ?? "Gaismas/demo-site",
  customerRepoMap: repoMap(),
  dbPath: process.env.DB_PATH ?? "./relais.db",
};
export type AppMode = "demo" | "live";
export function appMode(): AppMode {
  return config.modelApiKey ? "live" : "demo";
}
export function authorizedRepoFor(customerId: string): string | null {
  if (config.customerRepoMap[customerId]) return config.customerRepoMap[customerId];
  if (customerId === "demo-sarah") return config.demoRepo;
  return null;
}
