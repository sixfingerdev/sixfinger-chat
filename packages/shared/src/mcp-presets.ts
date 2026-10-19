/**
 * Hazır MCP bağlayıcı kataloğu (arayüzdeki "Bağlayıcılara göz at"). Sıra/açıklamalar Claude'un bağlayıcı listesine göre; adresler
 * vendor belgelerinden ya da dizinlerden derlendi.
 *
 * `auth`:
 *  - `dcr`: OAuth, dinamik istemci kaydı (kullanıcı tek tıkla bağlanır).
 *  - `static`: OAuth, istemci kimliği SUNUCU YÖNETİCİSİNDEDİR (`.env`: `MCP_<SAĞLAYICI>_CLIENT_ID/SECRET`); tanımlı değilse kart pasif.
 *  - `none`: kimlik doğrulama yok (adres değişkenleri olabilir). `token` alanı varsa anahtarla da bağlanılabilir.
 *  - `soon`: şimdilik bağlanamaz.
 * `status`: `ready` adres belgelenmiş, `verify` adres/kayıt yöntemi dış kaynaklardan (gerçek bağlantıda doğrulanmalı), `soon` pasif.
 */
export type McpPresetAuth = 'dcr' | 'static' | 'none' | 'soon';
export type McpStaticProvider = 'google' | 'slack' | 'hubspot';

export interface McpPresetVariable {
  key: string;
  label: { tr: string; en: string };
  placeholder: string;
}

export interface McpPreset {
  id: string;
  label: string;
  rank: number;
  description: { tr: string; en: string };
  /** `{degisken}` yer tutucuları `variables` ile doldurulur. Boşsa (soon) adres yoktur. */
  url: string;
  auth: McpPresetAuth;
  provider?: McpStaticProvider;
  /** İstenen OAuth kapsamları (varsa). */
  scopes?: string[];
  interactive?: boolean;
  status: 'ready' | 'verify' | 'soon';
  variables?: McpPresetVariable[];
  /** OAuth yerine anahtarla bağlanma seçeneği. */
  token?: { header: string; prefix?: string; label: { tr: string; en: string }; hint?: { tr: string; en: string } };
  note?: { tr: string; en: string };
  docs?: string;
}

export const MCP_PRESETS: McpPreset[] = [
  { id: "google-drive", label: "Google Drive", rank: 1, description: { tr: "Dosyaları anında ara, oku ve yükle", en: "Search, read, and upload files instantly" }, url: "https://drivemcp.googleapis.com/mcp/v1", auth: "static", provider: "google", scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"], status: "ready", docs: "https://developers.google.com/workspace/guides/configure-mcp-servers" },
  { id: "gmail", label: "Gmail", rank: 2, description: { tr: "Yanıt taslağı yaz, yazışmaları özetle, gelen kutunda ara", en: "Draft replies, summarize threads, & search your inbox" }, url: "https://gmailmcp.googleapis.com/mcp/v1", auth: "static", provider: "google", scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"], status: "ready", docs: "https://developers.google.com/workspace/guides/configure-mcp-servers" },
  { id: "google-calendar", label: "Google Calendar", rank: 3, description: { tr: "Takvimini yönet, toplantıları kolayca ayarla", en: "Manage your schedule and coordinate meetings effortlessly" }, url: "https://calendarmcp.googleapis.com/mcp/v1", auth: "static", provider: "google", scopes: ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events.freebusy", "https://www.googleapis.com/auth/calendar.events.readonly"], status: "ready", docs: "https://developers.google.com/workspace/guides/configure-mcp-servers" },
  { id: "canva", label: "Canva", rank: 4, description: { tr: "Canva tasarımlarını ara, oluştur, doldur ve dışa aktar", en: "Search, create, autofill, and export Canva designs" }, url: "https://mcp.canva.com/mcp", auth: "dcr", interactive: true, status: "ready" },
  { id: "microsoft-365", label: "Microsoft 365", rank: 5, description: { tr: "Şirketinin SharePoint, OneDrive, Outlook ve Teams verilerine eriş", en: "Access your company's SharePoint, OneDrive, Outlook, and Teams" }, url: "", auth: "soon", status: "soon", note: {"tr": "Herkese açık resmi bir MCP adresi yok (Microsoft Agent 365 lisansı gerekir). Adresin varsa “Özel URL” ile ekleyebilirsin.", "en": "There is no public official MCP endpoint (needs a Microsoft Agent 365 licence). If you have one, add it with “Custom URL”."} },
  { id: "notion", label: "Notion", rank: 6, description: { tr: "Notion çalışma alanını ara, güncelle ve iş akışlarına bağla", en: "Connect your Notion workspace to search, update, and power workflows across tools" }, url: "https://mcp.notion.com/mcp", auth: "dcr", status: "verify" },
  { id: "figma", label: "Figma", rank: 7, description: { tr: "Figma tasarımlarını ve bileşenlerini iş akışına getir", en: "Bring Figma designs, components and context into your workflow" }, url: "https://mcp.figma.com/mcp", auth: "dcr", interactive: true, status: "verify" },
  { id: "slack", label: "Slack", rank: 8, description: { tr: "Mesaj gönder, canvas oluştur, Slack verilerini getir", en: "Send messages, create canvases, and fetch Slack data" }, url: "https://mcp.slack.com/mcp", auth: "static", provider: "slack", interactive: true, status: "verify", note: {"tr": "Slack dinamik kayıt desteklemez: sunucu yöneticisi kendi Slack uygulamasını (dahili ya da dizinde yayımlı) kaydedip MCP_SLACK_CLIENT_ID/SECRET girmelidir.", "en": "Slack has no dynamic registration: the server admin must register their own Slack app (internal or directory-published) and set MCP_SLACK_CLIENT_ID/SECRET."} },
  { id: "hubspot", label: "HubSpot", rank: 9, description: { tr: "Her yanıt ve eylem için CRM bağlamı", en: "CRM context for every answer, insight, and action" }, url: "https://mcp.hubspot.com/anthropic", auth: "static", provider: "hubspot", interactive: true, status: "verify", note: {"tr": "HubSpot istemci kaydı yöntemi doğrulanmadı: önce dinamik kayıt denenir; olmazsa MCP_HUBSPOT_CLIENT_ID/SECRET gerekir.", "en": "HubSpot’s client registration method is unverified: dynamic registration is tried first; otherwise MCP_HUBSPOT_CLIENT_ID/SECRET is required."} },
  { id: "asana", label: "Asana", rank: 10, description: { tr: "Görevleri, projeleri ve hedefleri Asana ile koordine et", en: "Connect to Asana to coordinate tasks, projects, and goals" }, url: "https://mcp.asana.com/sse", auth: "dcr", interactive: true, status: "verify" },
  { id: "linear", label: "Linear", rank: 11, description: { tr: "Linear’da sorunları, projeleri ve ekip iş akışlarını yönet", en: "Manage issues, projects & team workflows in Linear" }, url: "https://mcp.linear.app/mcp", auth: "dcr", status: "verify", token: {"header": "Authorization", "prefix": "Bearer ", "label": {"tr": "Linear API anahtarı", "en": "Linear API key"}, "hint": {"tr": "OAuth yerine anahtar kullanmak istersen.", "en": "If you prefer a key over OAuth."}} },
  { id: "google-sheets", label: "Google Sheets", rank: 12, description: { tr: "Tablolarını oku, analiz et ve güncelle", en: "Read, analyze, and update your spreadsheets" }, url: "https://sheetsmcp.googleapis.com/mcp/v1", auth: "static", provider: "google", scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/spreadsheets"], status: "ready", docs: "https://developers.google.com/workspace/guides/configure-mcp-servers" },
  { id: "monday", label: "monday.com", rank: 13, description: { tr: "Projeler, görevler, panolar, iş akışları ve CRM için monday.com", en: "monday.com project management & CRM for projects, tasks, portfolios, boards, workflows, milestones, dependencies" }, url: "https://mcp.monday.com/mcp", auth: "dcr", interactive: true, status: "verify" },
  { id: "google-docs", label: "Google Docs", rank: 14, description: { tr: "Belgelerini düzenle, yorumla ve özetle", en: "Edit, comment on, and summarize your documents" }, url: "https://docsmcp.googleapis.com/mcp/v1", auth: "static", provider: "google", scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/documents.readonly", "https://www.googleapis.com/auth/documents"], status: "ready", docs: "https://developers.google.com/workspace/guides/configure-mcp-servers" },
  { id: "intercom", label: "Intercom", rank: 15, description: { tr: "Daha iyi müşteri içgörüleri için Intercom verilerine eriş", en: "Access to Intercom data for better customer insights" }, url: "https://mcp.intercom.com/mcp", auth: "dcr", status: "verify" },
  { id: "box", label: "Box", rank: 16, description: { tr: "Box içeriğini ara, düzenle ve içgörü al", en: "Search, edit and get insights on your Box content" }, url: "https://mcp.box.com/", auth: "dcr", interactive: true, status: "verify" },
  { id: "google-slides", label: "Google Slides", rank: 17, description: { tr: "Sunumlarını oku, düzenle ve slayt ekle", en: "Read, edit, and add slides to your presentations" }, url: "https://slidesmcp.googleapis.com/mcp/v1", auth: "static", provider: "google", scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/presentations.readonly", "https://www.googleapis.com/auth/presentations"], status: "ready", docs: "https://developers.google.com/workspace/guides/configure-mcp-servers" },
  { id: "adobe", label: "Adobe", rank: 18, description: { tr: "Adobe profesyonel araçlarıyla tasarla, birleştir ve düzenle", en: "Design, combine, and edit with Adobe pro tools" }, url: "https://adobe-creativity.adobe.io/mcp", auth: "dcr", interactive: true, status: "verify" },
  { id: "miro", label: "Miro", rank: 19, description: { tr: "Miro panolarındaki içeriğe eriş ve yenisini oluştur", en: "Access and create new content on Miro boards" }, url: "https://mcp.miro.com/", auth: "dcr", interactive: true, status: "verify" },
  { id: "supabase", label: "Supabase", rank: 20, description: { tr: "Veritabanlarını, kimlik doğrulamayı ve depolamayı yönet", en: "Manage databases, authentication, and storage" }, url: "https://mcp.supabase.com/mcp", auth: "dcr", status: "verify", token: {"header": "Authorization", "prefix": "Bearer ", "label": {"tr": "Supabase kişisel erişim jetonu", "en": "Supabase personal access token"}, "hint": {"tr": "OAuth yerine jeton kullanmak istersen.", "en": "If you prefer a token over OAuth."}} },
  { id: "shopify", label: "Shopify", rank: 21, description: { tr: "Shopify mağazanı kur, yönet ve analiz et", en: "Build, manage, and analyze your Shopify store" }, url: "https://{shop}.myshopify.com/api/mcp", auth: "none", interactive: true, status: "verify", variables: [{"key": "shop", "label": {"tr": "Mağaza adı", "en": "Store name"}, "placeholder": "my-store"}], note: {"tr": "Mağazanın herkese açık Storefront MCP adresine bağlanır (ürün arama, sepet, politikalar); kimlik doğrulama gerektirmez.", "en": "Connects to the store’s public Storefront MCP endpoint (product search, cart, policies); no authentication."} },
  { id: "indeed", label: "Indeed", rank: 22, description: { tr: "Indeed’de iş ara", en: "Search for jobs on Indeed" }, url: "https://mcp.indeed.com/claude/mcp", auth: "dcr", status: "verify" },
  { id: "vercel", label: "Vercel", rank: 23, description: { tr: "Projeleri ve dağıtımları analiz et, hata ayıkla ve yönet", en: "Analyze, debug, and manage projects and deployments" }, url: "https://mcp.vercel.com/", auth: "dcr", status: "verify" },
  { id: "gamma", label: "Gamma", rank: 24, description: { tr: "Yapay zekâyla sunum, belge, sosyal içerik ve site oluştur", en: "Create presentations, docs, socials, and sites with AI" }, url: "https://mcp.gamma.app/mcp", auth: "dcr", interactive: true, status: "verify" },
  { id: "spotify", label: "Spotify", rank: 25, description: { tr: "Sana özel müzik ve podcast önerileri", en: "Music and podcast recommendations, just for you" }, url: "https://mcp-gateway-external-pilot.spotify.net/mcp", auth: "dcr", interactive: true, status: "verify", note: {"tr": "Spotify’ın bu adresi pilot aşamasında ve doğrulanmadı; çalışmazsa adresi düzenleyebilirsin.", "en": "Spotify’s endpoint is a pilot and unverified; edit the address if it does not work."} },
  { id: "wispr-flow", label: "Wispr Flow", rank: 26, description: { tr: "Wispr Flow’daki toplantıların, notların ve görevlerin", en: "Your meetings, notes, and tasks from Wispr Flow" }, url: "https://api.wisprflow.ai/connect/mcp", auth: "dcr", status: "verify", note: {"tr": "Wispr Flow ayarlarında MCP’yi önce açman gerekir.", "en": "Turn MCP on in Wispr Flow settings first."} },
  { id: "granola", label: "Granola", rank: 27, description: { tr: "Toplantılar için yapay zekâ not defteri", en: "The AI notepad for meetings" }, url: "https://mcp.granola.ai/mcp", auth: "dcr", interactive: true, status: "verify" },
];

export const mcpPreset = (id: string | null | undefined): McpPreset | undefined => (id ? MCP_PRESETS.find((p) => p.id === id) : undefined);

/** Adres şablonundaki `{anahtar}` yer tutucularını doldurur; eksik değişken varsa null. */
export function fillPresetUrl(preset: McpPreset, values: Record<string, string>): string | null {
  let missing = false;
  const url = preset.url.replace(/\{([a-z_]+)\}/g, (_m, k: string) => {
    const v = (values[k] ?? '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(v)) missing = true;
    return v;
  });
  return missing ? null : url;
}
