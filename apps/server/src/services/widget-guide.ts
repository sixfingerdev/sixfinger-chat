/**
 * Widget tasarım rehberi (sistem istemine girer). Küçük modeller için kurallar + iki örnek:
 * örnekler kopyalanabilir kalıplardır; model yapıyı ve sınıf sözlüğünü onlardan öğrenir.
 */

const CALCULATOR = `<widget title="Bileşik faiz" height="330">
<div class="sf-stack">
  <div class="sf-field"><div class="sf-field-head"><span>Ana para</span><output id="pv"></output></div><input id="p" type="range" min="1000" max="200000" step="1000" value="50000"></div>
  <div class="sf-field"><div class="sf-field-head"><span>Yıllık faiz</span><output id="rv"></output></div><input id="r" type="range" min="1" max="40" step="0.5" value="12"></div>
  <div class="sf-field"><div class="sf-field-head"><span>Süre</span><output id="yv"></output></div><input id="y" type="range" min="1" max="30" value="10"></div>
  <div class="sf-grid">
    <div class="sf-stat"><span class="l">Sonuç</span><span class="v" id="out"></span></div>
    <div class="sf-stat"><span class="l">Kazanç</span><span class="v" id="gain"></span><span class="d up" id="pct"></span></div>
  </div>
</div>
<script>
const $=i=>document.getElementById(i),n=v=>Math.round(v).toLocaleString('tr-TR');
function up(){const P=+$('p').value,r=+$('r').value,y=+$('y').value,A=P*Math.pow(1+r/100,y);
$('pv').textContent=n(P)+' ₺';$('rv').textContent='%'+r;$('yv').textContent=y+' yıl';
$('out').textContent=n(A)+' ₺';$('gain').textContent='+'+n(A-P)+' ₺';$('pct').textContent='%'+n((A/P-1)*100)+' artış'}
document.addEventListener('input',up);up();
</script>
</widget>`;

const BAR_CHART = `<widget title="Aylık harcama (₺)" height="250">
<svg viewBox="0 0 320 190" role="img" aria-label="Aylık harcama">
  <line class="sf-gridline" x1="40" x2="316" y1="20" y2="20"/><line class="sf-gridline" x1="40" x2="316" y1="70" y2="70"/>
  <line class="sf-gridline" x1="40" x2="316" y1="120" y2="120"/><line class="sf-gridline" x1="40" x2="316" y1="170" y2="170"/>
  <text class="sf-axis" x="34" y="24" text-anchor="end">4k</text><text class="sf-axis" x="34" y="74" text-anchor="end">3k</text>
  <text class="sf-axis" x="34" y="124" text-anchor="end">2k</text><text class="sf-axis" x="34" y="174" text-anchor="end">0</text>
  <rect x="58" y="80" width="34" height="90" rx="4" fill="var(--sf-c1)"/><rect x="108" y="54" width="34" height="116" rx="4" fill="var(--sf-c1)"/>
  <rect x="158" y="65" width="34" height="105" rx="4" fill="var(--sf-c1)"/><rect x="208" y="35" width="34" height="135" rx="4" fill="var(--sf-c1)"/>
  <rect x="258" y="58" width="34" height="112" rx="4" fill="var(--sf-c1)"/>
  <text class="sf-axis" x="75" y="186" text-anchor="middle">Oca</text><text class="sf-axis" x="125" y="186" text-anchor="middle">Şub</text>
  <text class="sf-axis" x="175" y="186" text-anchor="middle">Mar</text><text class="sf-axis" x="225" y="186" text-anchor="middle">Nis</text>
  <text class="sf-axis" x="275" y="186" text-anchor="middle">May</text>
</svg>
</widget>`;

export const WIDGET_GUIDE =
  `Widget (mesaj içi küçük etkileşimli parça): Açıklamanı güçlendirecek küçük bir görsel ya da etkileşim için (grafik, kaydırıcılı hesaplayıcı, şema, mini demo) metnin içine ` +
  `<widget title="Kısa ad" height="320">...</widget> koy. İçerik tam sayfa değil, yalnızca HTML/CSS/JS gövdesi olsun. Küçük tut (en fazla ~400px); oyun ve uygulama gibi büyük işler artifact olsun. ` +
  `Widget'tan sonra "kodu yapıştır" deme: kullanıcı onu zaten çalışır halde görür. Takip sorusu önermek için window.sf.sendPrompt("...") kullanabilirsin.\n` +
  `TASARIM: Hazır bir stil setin var; kendi CSS'ini yazma, bu sınıfları kullan. Düzen: sf-stack (dikey, aralıklı), sf-row (yatay, sarar), sf-grid (otomatik sütun), sf-card, sf-between. ` +
  `Metin: sf-title (başlık), sf-label (küçük büyük harfli etiket), sf-muted. Alan: sf-field > sf-field-head (etiket + <output> değeri) + input[type=range] (kaydırıcı vurgu rengiyle dolar). ` +
  `Değer kartı: sf-stat > .l (etiket), .v (büyük değer), .d (açıklama; .up yeşil, .down kırmızı). Diğer: sf-chip (etiket/seçenek; .on seçili), sf-bar > i (ilerleme çubuğu, style="width:%"), sf-callout (not kutusu), sf-legend (grafik açıklaması), <table> (doğrudan stillidir). ` +
  `Düğme: <button> hazır görünür; ana eylem için <button class="primary">. Renkler: grafik serileri var(--sf-c1) (ana vurgu: koyuda beyaz, açıkta siyah), --sf-c2, --sf-c3, --sf-c4, --sf-c5; anlam renkleri var(--sf-good), var(--sf-bad), var(--sf-warn); metin var(--sf-text), var(--sf-text2), var(--sf-text3); çizgi var(--sf-line).\n` +
  `KURALLAR: Tek vurgu rengi kullan; emoji, gradyan, gölge ve renkli arka plan blokları yok. Sonuç/ana değer en büyük öğe olsun (sf-stat .v). Etiketler kısa. İlk görünüm dolu ve gerçekçi varsayılan değerlerle açılsın (boş kabuk olmasın). ` +
  `Sayıları .toLocaleString('tr-TR') ile biçimlendir, birimi yaz (₺, %, yıl). Telefonda (~340px) yatay kaydırma olmasın; en çok 2 sütun. Grafiği 2-8 öğe için satır içi SVG ile çiz (viewBox kullan; eksen yazısı class="sf-axis", çizgi class="sf-gridline", seri fill="var(--sf-c1)"); ` +
  `çok veri ya da etkileşim gerekirse Chart.js yükle (https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js; canvas'ı yüksekliği verilmiş bir div içine koy, sonra sf.chartDefaults(Chart) çağır ve renkler için sf.theme.colors kullan). ` +
  `Aynı sınıflar artifact'larda da çalışır.\n` +
  `ÖRNEK 1 (hesaplayıcı):\n${CALCULATOR}\nÖRNEK 2 (çubuk grafik):\n${BAR_CHART}`;

export const WIDGET_EXAMPLES = { CALCULATOR, BAR_CHART };
