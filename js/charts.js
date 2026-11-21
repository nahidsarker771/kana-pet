/* KanaPet — All Kana Charts Display */
(function() {
  'use strict';

  // Gojūon layout: 5 vowel columns (a i u e o), rows per consonant.
  // null = empty slot so every row keeps the traditional alignment.
  var BASIC_ROWS = [
    ['a', 'i', 'u', 'e', 'o'],
    ['ka', 'ki', 'ku', 'ke', 'ko'],
    ['sa', 'shi', 'su', 'se', 'so'],
    ['ta', 'chi', 'tsu', 'te', 'to'],
    ['na', 'ni', 'nu', 'ne', 'no'],
    ['ha', 'hi', 'fu', 'he', 'ho'],
    ['ma', 'mi', 'mu', 'me', 'mo'],
    ['ya', null, 'yu', null, 'yo'],
    ['ra', 'ri', 'ru', 're', 'ro'],
    ['wa', null, null, null, 'wo'],
    ['n', null, null, null, null]
  ];
  var DAKUTEN_ROWS = [
    ['ga', 'gi', 'gu', 'ge', 'go'],
    ['za', 'ji', 'zu', 'ze', 'zo'],
    ['da', 'di', 'du', 'de', 'do'],
    ['ba', 'bi', 'bu', 'be', 'bo']
  ];
  var HANDAKUTEN_ROWS = [
    ['pa', 'pi', 'pu', 'pe', 'po']
  ];
  var YOON_ROWS = [
    ['kya', 'kyu', 'kyo'],
    ['sha', 'shu', 'sho'],
    ['cha', 'chu', 'cho'],
    ['nya', 'nyu', 'nyo'],
    ['hya', 'hyu', 'hyo'],
    ['mya', 'myu', 'myo'],
    ['rya', 'ryu', 'ryo'],
    ['gya', 'gyu', 'gyo'],
    ['ja', 'ju', 'jo'],
    ['bya', 'byu', 'byo'],
    ['pya', 'pyu', 'pyo']
  ];

  var BASIC = [
    ['a','あ','ア'], ['i','い','イ'], ['u','う','ウ'], ['e','え','エ'], ['o','お','オ'],
    ['ka','か','カ'], ['ki','き','キ'], ['ku','く','ク'], ['ke','け','ケ'], ['ko','こ','コ'],
    ['sa','さ','サ'], ['shi','し','シ'], ['su','す','ス'], ['se','せ','セ'], ['so','そ','ソ'],
    ['ta','た','タ'], ['chi','ち','チ'], ['tsu','つ','ツ'], ['te','て','テ'], ['to','と','ト'],
    ['na','な','ナ'], ['ni','に','ニ'], ['nu','ぬ','ヌ'], ['ne','ね','ネ'], ['no','の','ノ'],
    ['ha','は','ハ'], ['hi','ひ','ヒ'], ['fu','ふ','フ'], ['he','へ','ヘ'], ['ho','ほ','ホ'],
    ['ma','ま','マ'], ['mi','み','ミ'], ['mu','む','ム'], ['me','め','メ'], ['mo','も','モ'],
    ['ya','や','ヤ'], ['yu','ゆ','ユ'], ['yo','よ','ヨ'],
    ['ra','ら','ラ'], ['ri','り','リ'], ['ru','る','ル'], ['re','れ','レ'], ['ro','ろ','ロ'],
    ['wa','わ','ワ'], ['wo','を','ヲ'], ['n','ん','ン']
  ];
  var DAKUTEN = [
    ['ga','が','ガ'], ['gi','ぎ','ギ'], ['gu','ぐ','グ'], ['ge','げ','ゲ'], ['go','ご','ゴ'],
    ['za','ざ','ザ'], ['ji','じ','ジ'], ['zu','ず','ズ'], ['ze','ぜ','ゼ'], ['zo','ぞ','ゾ'],
    ['da','だ','ダ'], ['di','ぢ','ヂ'], ['du','づ','ヅ'], ['de','で','デ'], ['do','ど','ド'],
    ['ba','ば','バ'], ['bi','び','ビ'], ['bu','ぶ','ブ'], ['be','べ','ベ'], ['bo','ぼ','ボ']
  ];
  var HANDAKUTEN = [
    ['pa','ぱ','パ'], ['pi','ぴ','ピ'], ['pu','ぷ','プ'], ['pe','ぺ','ペ'], ['po','ぽ','ポ']
  ];
  var YOON = [
    ['kya','きゃ','キャ'], ['kyu','きゅ','キュ'], ['kyo','きょ','キョ'],
    ['sha','しゃ','シャ'], ['shu','しゅ','シュ'], ['sho','しょ','ショ'],
    ['cha','ちゃ','チャ'], ['chu','ちゅ','チュ'], ['cho','ちょ','チョ'],
    ['nya','にゃ','ニャ'], ['nyu','にゅ','ニュ'], ['nyo','にょ','ニョ'],
    ['hya','ひゃ','ヒャ'], ['hyu','ひゅ','ヒュ'], ['hyo','ひょ','ヒョ'],
    ['mya','みゃ','ミャ'], ['myu','みゅ','ミュ'], ['myo','みょ','ミョ'],
    ['rya','りゃ','リャ'], ['ryu','りゅ','リュ'], ['ryo','りょ','リョ'],
    ['gya','ぎゃ','ギャ'], ['gyu','ぎゅ','ギュ'], ['gyo','ぎょ','ギョ'],
    ['ja','じゃ','ジャ'], ['ju','じゅ','ジュ'], ['jo','じょ','ジョ'],
    ['bya','びゃ','ビャ'], ['byu','びゅ','ビュ'], ['byo','びょ','ビョ'],
    ['pya','ぴゃ','ピャ'], ['pyu','ぴゅ','ピュ'], ['pyo','ぴょ','ピョ']
  ];

  var ROWS_BY_TYPE = {
    basic: { rows: BASIC_ROWS, cols: 5 },
    dakuten: { rows: DAKUTEN_ROWS, cols: 5 },
    handakuten: { rows: HANDAKUTEN_ROWS, cols: 5 },
    yoon: { rows: YOON_ROWS, cols: 3 }
  };

  function createChart() {
    var chartData = [];
    BASIC.forEach(function(r){ chartData.push({romaji:r[0], hira:r[1], kata:r[2], type:'basic'}); });
    DAKUTEN.forEach(function(r){ chartData.push({romaji:r[0], hira:r[1], kata:r[2], type:'dakuten'}); });
    HANDAKUTEN.forEach(function(r){ chartData.push({romaji:r[0], hira:r[1], kata:r[2], type:'handakuten'}); });
    YOON.forEach(function(r){ chartData.push({romaji:r[0], hira:r[1], kata:r[2], type:'yoon'}); });
    return chartData;
  }

  var allKana = createChart();
  var byRomaji = {};
  allKana.forEach(function(item) { byRomaji[item.romaji] = item; });

  function kanaCell(item, script) {
    var aria = window.I18n ? window.I18n.t('ariaHearKana').split('{romaji}').join(item.romaji) : 'Hear ' + item.romaji;
    var glyphs = script === 'hira' ? [item.hira] : script === 'kata' ? [item.kata] : [item.hira, item.kata];
    return glyphs.map(function(glyph) {
      return '<div class="chart-kana jp kana-sound" data-speak="' + glyph + '" role="button" tabindex="0" aria-label="' + aria + '">' + glyph + '</div>';
    }).join('');
  }

  function cellHtml(item, script) {
    return '<div class="chart-cell"><div class="chart-romaji">' + item.romaji + '</div>' + kanaCell(item, script) + '</div>';
  }

  function rowsHtml(type, script) {
    var layout = ROWS_BY_TYPE[type];
    if (!layout) return '';
    var html = '<div class="chart-grid' + (layout.cols === 3 ? ' chart-grid-yoon' : '') + '">';
    layout.rows.forEach(function(row) {
      row.forEach(function(romaji) {
        if (!romaji) {
          html += '<div class="chart-cell chart-cell-empty" aria-hidden="true"></div>';
          return;
        }
        var item = byRomaji[romaji];
        if (item) html += cellHtml(item, script);
      });
    });
    return html + '</div>';
  }

  function searchGridHtml(items, script) {
    var html = '<div class="chart-grid chart-grid-search">';
    items.forEach(function(item) { html += cellHtml(item, script); });
    return html + '</div>';
  }

  // filter: { chart: all|hira|kata|basic|dakuten|handakuten|yoon,
  //           search: string, container: element id }
  // "hira"/"kata" show only that script in each cell; the rest filter by type.
  function renderCharts(filter) {
    filter = filter || {};
    var container = document.getElementById(filter.container || 'charts-container');
    if (!container) return;

    var chart = filter.chart || 'all';
    var script = filter.script || 'all';
    if (chart === 'hira' || chart === 'kata') { script = chart; chart = 'all'; }
    var search = String(filter.search || '').trim().toLowerCase();

    var filtered = allKana.filter(function(item) {
      if (search) {
        var hit = item.romaji.indexOf(search) !== -1 ||
                  item.hira.indexOf(search) !== -1 ||
                  item.kata.indexOf(search) !== -1;
        if (!hit) return false;
      }
      return chart === 'all' || item.type === chart;
    });

    // Group by type
    var groups = {};
    filtered.forEach(function(item) {
      if (!groups[item.type]) groups[item.type] = [];
      groups[item.type].push(item);
    });

    var typeLabels = {
      basic: (window.I18n ? window.I18n.t('monographs') : 'Monographs'),
      dakuten: (window.I18n ? window.I18n.t('tenTen') : 'Ten-ten'),
      handakuten: (window.I18n ? window.I18n.t('handakuten') : 'Handakuten'),
      yoon: (window.I18n ? window.I18n.t('yoonSet') : 'Yōon')
    };

    var html = '';
    ['basic', 'dakuten', 'handakuten', 'yoon'].forEach(function(t) {
      if (!groups[t] || !groups[t].length) return;
      html += '<div class="chart-section">';
      html += '<h4>' + typeLabels[t] + '</h4>';
      html += search ? searchGridHtml(groups[t], script) : rowsHtml(t, script);
      html += '</div>';
    });
    if (!html) {
      html = '<div class="empty-note">' + (window.I18n ? window.I18n.t('noResults') : 'No results') + '</div>';
    }
    container.innerHTML = html;
  }

  window.Charts = {
    render: renderCharts,
    all: allKana
  };
})();
