/**
 * Dil yardımcıları (kütüphanesiz): metnin dilini kabaca bulma, cümlelere bölüp dile göre gruplama ve
 * aynı sese birden çok dilde çalışan tanıyıcılar arasından en uygun çıktıyı seçme.
 * Yalnızca adayları (kullanıcının seçili dilleri) ayırt eder; geniş bir dil tanıma değildir.
 */

/** "it-IT" → "it". */
export const langBase = (tag: string): string => tag.split(/[-_]/)[0]!.toLowerCase();

interface LatinProfile {
  /** Sık kullanılan işlev sözcükleri. */
  words: string;
  /** O dile özgü (başka Latin adaylarda seyrek) harfler. */
  chars: string;
}

const LATIN: Record<string, LatinProfile> = {
  tr: {
    words:
      'bir bu ve de da ne için ile ama çok daha gibi mi mı mu mü ben sen biz siz var yok değil nasıl neden nerede hangi kadar sonra önce şimdi lütfen evet hayır merhaba selam teşekkürler tamam olarak olan bana beni sana seni bunu şunu bunun ki ya hem her bütün',
    chars: 'ğışİı',
  },
  en: {
    words:
      'the and is are was were to of in that it for with as on be this have not you what how why can will would should do does my your please hello hi thanks yes no from at by an or but about there their they we he she i me',
    chars: '',
  },
  it: {
    words:
      'il lo la le gli un una di che è e non per con come sono ho hai ha mi ti ci si questo questa quello cosa perché dove quando anche più molto ciao grazie prego buongiorno nel nella della del dei delle sul sulla al alla',
    chars: 'àèìòù',
  },
  de: {
    words:
      'der die das und ist nicht ein eine zu den dem des mit auf für ich du er sie es wir ihr wie was warum wo kann bitte danke hallo ja nein auch sich von im am aber oder wenn dass noch schon sehr',
    chars: 'ßäöü',
  },
  fr: {
    words:
      'le la les un une des et est ne pas pour avec que qui dans sur au aux du de je tu il elle nous vous ils elles comment pourquoi où bonjour merci oui non très aussi mais ou donc cette ce ces mon ma mes',
    chars: 'éèêàçùœâîôû',
  },
  es: {
    words:
      'el la los las un una y es no por con que se de en para como pero más muy yo tú él ella nosotros qué cómo por qué dónde hola gracias sí también este esta eso esto del al lo mi su',
    chars: 'ñ¿¡áíóúé',
  },
  pt: {
    words:
      'o a os as um uma e é não por com que se de em para como mas mais muito eu tu ele ela nós você vocês olá obrigado obrigada sim também este esta isso isto do da dos das no na meu minha',
    chars: 'ãõçâêô',
  },
  nl: {
    words:
      'de het een en is niet te van in dat op voor met als zijn ik je jij hij zij wij we hoe wat waarom waar hallo dank alstublieft ja nee ook maar of dan nog al heel',
    chars: '',
  },
  pl: {
    words: 'i w nie na to jest się z do że jak co ale czy dla tak już bardzo ja ty on ona my wy cześć dziękuję proszę',
    chars: 'ąęłńśźżć',
  },
};

const LATIN_SETS: Record<string, { words: Set<string>; chars: Set<string> }> = Object.fromEntries(
  Object.entries(LATIN).map(([k, v]) => [k, { words: new Set(v.words.split(' ')), chars: new Set(v.chars.split('')) }]),
);

/** Betik (alfabe) → o betiği kullanan dil kodları. */
const SCRIPTS: Array<{ re: RegExp; langs: string[] }> = [
  { re: /[Ѐ-ӿ]/g, langs: ['ru', 'uk', 'bg', 'sr', 'be', 'kk'] },
  { re: /[؀-ۿ]/g, langs: ['ar', 'fa', 'ur'] },
  { re: /[֐-׿]/g, langs: ['he'] },
  { re: /[Ͱ-Ͽ]/g, langs: ['el'] },
  { re: /[぀-ヿ]/g, langs: ['ja'] },
  { re: /[가-힯]/g, langs: ['ko'] },
  { re: /[一-鿿]/g, langs: ['zh', 'ja'] },
  { re: /[ऀ-ॿ]/g, langs: ['hi', 'mr'] },
  { re: /[฀-๿]/g, langs: ['th'] },
];

export interface LangGuess {
  /** Aday listesindeki kodun tabanı ("it"). */
  lang: string;
  /** 0–1: ne kadar emin. */
  confidence: number;
}

/**
 * `candidates` (ör. ["tr-TR","en-US"]) arasından metnin dilini bulur. Kanıt yetersizse null.
 * Tek aday varsa soru sormaz: null döner (karar zaten belli).
 */
export function detectLanguage(text: string, candidates: string[]): LangGuess | null {
  const bases = [...new Set(candidates.map(langBase))];
  if (bases.length < 2) return null;
  const sample = text.slice(0, 600);
  const letters = (sample.match(/[A-Za-zÀ-ɏͰ-῿぀-鿿가-힯]/g) ?? []).length;
  if (letters === 0) return null;

  // 1) Latin dışı betik: o betiği kullanan tek bir aday varsa kesin.
  for (const s of SCRIPTS) {
    const n = (sample.match(s.re) ?? []).length;
    if (n / letters < 0.4) continue;
    const hit = bases.filter((b) => s.langs.includes(b));
    if (hit.length === 1) return { lang: hit[0]!, confidence: 0.95 };
    if (hit.length > 1) return { lang: hit[0]!, confidence: 0.5 };
    // betik adaylardan hiçbirine uymuyor: Latin adaylar elenmiş olur
    return null;
  }

  // 2) Latin: işlev sözcükleri + özgün harfler.
  const norm = sample.replace(/İ/g, 'i').toLowerCase();
  const tokens = norm.match(/[a-zÀ-ɏ]+/g) ?? [];
  if (tokens.length === 0) return null;
  const scores: Array<[string, number]> = [];
  for (const b of bases) {
    const set = LATIN_SETS[b];
    if (!set) continue;
    let sc = 0;
    for (const tok of tokens) if (set.words.has(tok)) sc += 1;
    for (const ch of norm) if (set.chars.has(ch)) sc += 1.5;
    scores.push([b, sc]);
  }
  if (scores.length === 0) return null;
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = [scores[0]!, scores[1]];
  if (best[1] < 1) return null;
  const rest = second ? second[1] : 0;
  const margin = (best[1] - rest) / (best[1] + rest + 1);
  // az kelimede kanıt zayıf sayılır
  const volume = Math.min(1, best[1] / 3);
  return { lang: best[0], confidence: Math.max(0.05, Math.min(0.95, margin * volume)) };
}

export interface TranscriptCandidate {
  lang: string;
  text: string;
  /** Tanıyıcının güven puanı (0–1); yoksa/≤0 ise bilinmiyor sayılır. */
  confidence?: number;
}

/**
 * Aynı sese farklı dillerde çalışan tanıyıcıların çıktılarından en iyisinin dizinini verir (-1: hepsi boş).
 * Puan = tanıyıcının güveni + metnin dili o tanıyıcının diline uyuyorsa artı, başka bir dile uyuyorsa eksi.
 * Yanlış dilde çalışan tanıyıcı da "metin" üretir; bu yüzden yalnızca güvene bakmak yetmez.
 */
export function chooseTranscript(cands: TranscriptCandidate[], langs: string[], primary: string): number {
  let best = -1;
  let bestScore = -Infinity;
  const p = langBase(primary);
  cands.forEach((c, i) => {
    const text = c.text.trim();
    if (!text) return;
    let score = c.confidence && c.confidence > 0 ? c.confidence : 0.5;
    const guess = detectLanguage(text, langs);
    if (guess) score += (guess.lang === langBase(c.lang) ? 1 : -1) * 0.7 * guess.confidence;
    if (langBase(c.lang) === p) score += 0.05;
    // eşitlikte daha uzun (daha çok şey tanıyan) çıktı
    score += Math.min(text.split(/\s+/).length, 20) * 0.002;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Metni cümlelere böler (noktalama ve satır sonu korunur). */
export function splitSentences(text: string): string[] {
  const out = text.match(/[^.!?…\n]+[.!?…]*\s*|\n+/g) ?? [text];
  return out.map((s) => s.trim()).filter(Boolean);
}

export interface LangSegment {
  text: string;
  /** Taban dil kodu ("tr"). */
  lang: string;
}

/**
 * Yanıtı cümlelere bölüp her birine bir dil verir; art arda aynı dildeki cümleler birleştirilir.
 * Dili anlaşılamayan cümle, önceki cümlenin (yoksa `primary`) dilini alır.
 */
export function segmentByLanguage(text: string, langs: string[], primary: string): LangSegment[] {
  const out: LangSegment[] = [];
  let cur = langBase(primary);
  for (const s of splitSentences(text)) {
    const g = detectLanguage(s, langs);
    // kısa/belirsiz cümlede önceki dil sürer
    if (g && g.confidence >= 0.3) cur = g.lang;
    const last = out[out.length - 1];
    if (last && last.lang === cur) last.text += ` ${s}`;
    else out.push({ text: s, lang: cur });
  }
  return out;
}
