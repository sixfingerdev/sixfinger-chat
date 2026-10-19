/** SixFinger'ın kimliği: sistem istemlerinde modelin kendini ve ürünü tanıması için (sohbet ve Code ortak). */
export const SITE_URL = 'https://chat.sixfinger.live';

/** Logo (tek renk işaret). Web'deki `apps/web/public/logo.svg` ile aynı; koyu zeminde beyaz, açık zeminde siyah doldurulur. */
export const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="44 18 63 116" fill="currentColor" role="img" aria-label="SixFinger">' +
  '<polygon points="48.8,30.4 74,22.7 74,62.6 48.8,92.2"/><polygon points="77,22.7 102.2,30.4 102.5,52.5 58.5,87 59.2,85 77,62.6"/>' +
  '<polygon points="74.0,128.5 48.8,120.8 48.5,98.7 92.5,64.2 91.8,66.2 74.0,88.6"/><polygon points="102.2,120.8 77.0,128.5 77.0,88.6 102.2,59.0"/></svg>';

const LOGO_TR =
  `Logo: tek renkli (siyah-beyaz), dik ve keskin hatlı geometrik bir işaret; dört açılı çokgenden oluşur (üstte iki, altta iki), aralarında ince çapraz yarıklar kalır, bir "S" harfini ve parçalanmış bir eli andırır. ` +
  `Yazı logosu: geniş harf aralıklı, büyük harflerle "SIXFINGER". Marka siyah-beyazdır, renkli vurgu kullanmaz. Logoyu çizmen ya da kullanman istenirse bu SVG'yi aynen kullan (renk için fill="currentColor"; koyu zeminde beyaz, açık zeminde siyah ver): ${'```'}svg\n${LOGO_SVG}\n${'```'}`;

const LOGO_EN =
  `Logo: a monochrome (black and white) geometric mark with sharp, upright lines, made of four angular polygons (two on top, two below) separated by thin diagonal slits; it reads as an "S" and as a fractured hand. ` +
  `Wordmark: "SIXFINGER" in wide-tracked capital letters. The brand is black and white with no colored accent. If asked to draw or use the logo, use exactly this SVG (fill="currentColor"; white on dark backgrounds, black on light ones):\n${'```'}svg\n${LOGO_SVG}\n${'```'}`;

/** Sohbet asistanı için Türkçe tanıtım bloğu. */
export function brandPromptTr(): string {
  return (
    `SixFinger hakkında (kendini ve ürünü tanıtırken kullan; burada olmayan ayrıntıyı uydurma): SixFinger, yapay zekâ sohbeti ve bulut kodlama sunan bir üründür. Adresi ${SITE_URL}. ` +
    `Web uygulaması (telefona kurulabilen PWA) ve Android uygulaması vardır. İki bölümü var: **Chat** (bu sohbet: web araması, sandbox'ta kod çalıştırma, artifact ve widget üretimi, hafıza, kişiler) ve **Code** (GitHub reposunu bağlayıp kendi branch'inde çalışan, değişiklikleri commit edip pull request açan bulut kodlama ajanı). ` +
    LOGO_TR
  );
}

/** Code ajanı için İngilizce tanıtım bloğu. */
export function brandPromptEn(): string {
  return (
    `About SixFinger (use it when introducing yourself or the product; do not invent details that are not here): SixFinger is a product for AI chat and cloud coding at ${SITE_URL}. ` +
    `It has a web app (an installable PWA) and an Android app, with two parts: **Chat** (web search, running code in a sandbox, artifacts and widgets, memory, personas) and **Code** (this agent: it connects a GitHub repository, works on its own branch, commits the changes and opens a pull request). ` +
    LOGO_EN
  );
}
