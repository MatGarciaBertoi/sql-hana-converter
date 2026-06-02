/* Harness de teste do conversor — carrega o <script> do index.html com DOM stubado
   e roda uma bateria de casos T-SQL -> SAP HANA. Uso: node _test_converter.js   */
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.split('<script>')[1].split('</scr' + 'ipt>')[0];

const ctxStub = new Proxy({}, { get: () => (() => ctxStub) });
const elStub = new Proxy({
  checked: true, value: '', dataset: {}, textContent: '', innerHTML: '', style: {},
  getContext: () => ctxStub,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0 }),
  querySelector: () => elStub, querySelectorAll: () => [],
}, { get(t, p) { return p in t ? t[p] : (() => {}); } });
global.document = {
  getElementById: () => elStub, querySelector: () => elStub, querySelectorAll: () => [],
  createElement: () => elStub, addEventListener() {}, body: elStub, documentElement: elStub,
};
global.window = new Proxy({
  addEventListener() {}, requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  getComputedStyle: () => ({}), devicePixelRatio: 1, innerWidth: 1600, innerHeight: 900,
}, { get(t, p) { return p in t ? t[p] : (() => {}); } });
global.navigator = { clipboard: { writeText: () => Promise.resolve() }, userAgent: 'node' };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.requestAnimationFrame = () => 0; global.setInterval = () => 0; global.setTimeout = () => 0;

const wrapped = script + '\n;module.exports={convertToHana, cfg};';
const m = new module.constructor();
m._compile(wrapped, 'app.js');
const { convertToHana, cfg } = m.exports;
Object.assign(cfg, { uppercase: true, quotes: true, aliases: true, dummy: true, sapfields: true, indent: 4 });

let pass = 0, fail = 0;
const norm = x => x.replace(/\s+/g, ' ').trim();
function t(label, input, expected) {
  let out;
  try { out = convertToHana(input); }
  catch (e) { fail++; console.log('FAIL :: ' + label + '  (EXCEÇÃO: ' + e.message + ')'); return; }
  if (expected === null) {  /* só verifica que converteu sem lançar e gerou algo */
    if (out && out.trim()) { pass++; console.log('PASS :: ' + label + '  (sem erro)'); }
    else { fail++; console.log('FAIL :: ' + label + '  (saída vazia)'); }
    return;
  }
  const ok = norm(out) === norm(expected);
  if (ok) { pass++; console.log('PASS :: ' + label); }
  else {
    fail++;
    console.log('FAIL :: ' + label);
    console.log('   IN : ' + norm(input));
    console.log('   EXP: ' + norm(expected));
    console.log('   GOT: ' + norm(out));
  }
}

/* ===================== CASOS QUE JÁ DEVEM PASSAR ===================== */
t('colchetes + JOIN',
  'SELECT T0.[ItemCode] AS [Cod] FROM [dbo].[OITW] T0 INNER JOIN [dbo].[OITM] T1 ON T0.[ItemCode]=T1.[ItemCode]',
  'SELECT T0."ItemCode" AS "Cod" FROM "OITW" T0 INNER JOIN "OITM" T1 ON T0."ItemCode"=T1."ItemCode"');
t('simples WHERE',
  "SELECT * FROM OPCH WHERE DocEntry = 1 AND Canceled = 'N'",
  'SELECT * FROM "OPCH" WHERE "DocEntry" = 1 AND "Canceled" = \'N\'');
t('ISNULL->IFNULL', 'SELECT ISNULL(T0.X,0) FROM T', 'SELECT IFNULL(T0."X",0) FROM "T"');
t('LEN->LENGTH', 'SELECT LEN(T0.Name) FROM T', 'SELECT LENGTH(T0."Name") FROM "T"');

/* ===================== CASOS QUE PROVAVELMENTE FALHAM (gaps) ===================== */
// DATEDIFF com unidades diferentes de dia
t('DATEDIFF MONTH', 'SELECT DATEDIFF(MONTH, T0.D1, T0.D2) FROM T', 'SELECT MONTHS_BETWEEN(T0."D1", T0."D2") FROM "T"');
t('DATEDIFF YEAR', 'SELECT DATEDIFF(YEAR, T0.D1, T0.D2) FROM T', 'SELECT YEARS_BETWEEN(T0."D1", T0."D2") FROM "T"');
t('DATEDIFF SECOND', 'SELECT DATEDIFF(SECOND, T0.D1, T0.D2) FROM T', 'SELECT SECONDS_BETWEEN(T0."D1", T0."D2") FROM "T"');
// DATEADD com unidades
t('DATEADD MONTH', 'SELECT DATEADD(MONTH, 3, T0.D) FROM T', 'SELECT ADD_MONTHS(T0."D", 3) FROM "T"');
t('DATEADD YEAR', 'SELECT DATEADD(YEAR, 1, T0.D) FROM T', 'SELECT ADD_YEARS(T0."D", 1) FROM "T"');
// IIF
t('IIF', 'SELECT IIF(T0.Qty > 0, 1, 0) FROM T', 'SELECT CASE WHEN T0."Qty" > 0 THEN 1 ELSE 0 END FROM "T"');
// CAST para tipos numéricos / data
t('CAST INT', 'SELECT CAST(T0.X AS INT) FROM T', 'SELECT TO_INTEGER(T0."X") FROM "T"');
t('CAST DECIMAL', 'SELECT CAST(T0.X AS DECIMAL(18,2)) FROM T', 'SELECT TO_DECIMAL(T0."X", 18, 2) FROM "T"');
t('CAST DATE', 'SELECT CAST(T0.X AS DATE) FROM T', 'SELECT TO_DATE(T0."X") FROM "T"');
// NOLOCK hint deve ser removido
t('WITH (NOLOCK)', 'SELECT * FROM OINV T0 WITH (NOLOCK) WHERE T0.DocEntry = 1',
  'SELECT * FROM "OINV" T0 WHERE T0."DocEntry" = 1');
// GETUTCDATE
t('GETUTCDATE', 'SELECT GETUTCDATE() FROM DUMMY', 'SELECT CURRENT_UTCTIMESTAMP FROM DUMMY');
// EOMONTH
t('EOMONTH', 'SELECT EOMONTH(T0.D) FROM T', 'SELECT LAST_DAY(T0."D") FROM "T"');
// comentários de linha não devem ser convertidos
t('comentario de linha', 'SELECT T0.X FROM T -- comentario WHERE bla\nWHERE T0.X = 1',
  'SELECT T0."X" FROM "T" -- comentario WHERE bla\nWHERE T0."X" = 1');
// OFFSET/FETCH paginação
t('OFFSET FETCH', 'SELECT * FROM T ORDER BY T.X OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY',
  'SELECT * FROM "T" ORDER BY T."X" LIMIT 5 OFFSET 10');

/* ===================== REGRESSÃO SESSÕES ANTERIORES ===================== */
t('query do print (JOIN + colchetes + acentos)',
  `SELECT T0.[ItemCode] AS [Código do Item], T1.[ItemName] AS [Descrição]
   FROM [dbo].[OITW] T0 INNER JOIN [dbo].[OITM] T1 ON T0.[ItemCode] = T1.[ItemCode]
   WHERE T0.[ItemCode] = '[Inserir_Codigo]'`,
  `SELECT T0."ItemCode" AS "Código do Item", T1."ItemName" AS "Descrição"
   FROM "OITW" T0 INNER JOIN "OITM" T1 ON T0."ItemCode" = T1."ItemCode"
   WHERE T0."ItemCode" = '[Inserir_Codigo]'`);
t('variável SAP $[$..]',
  'SELECT T0.WhsCode FROM OITW T0 WHERE T0.WhsCode = $[$38.24]',
  'SELECT T0."WhsCode" FROM "OITW" T0 WHERE T0."WhsCode" = $[$38.24.0]');
t('BETWEEN não quebra no AND',
  "SELECT * FROM OINV T0 WHERE T0.DocDate BETWEEN '2024-01-01' AND '2024-12-31' AND T0.DocStatus = 'O'",
  `SELECT * FROM "OINV" T0 WHERE T0."DocDate" BETWEEN '2024-01-01' AND '2024-12-31' AND T0."DocStatus" = 'O'`);
t('TOP N → LIMIT',
  'SELECT TOP 10 T0.DocEntry FROM ORDR T0',
  'SELECT T0."DocEntry" FROM "ORDR" T0 LIMIT 10');
t('CONVERT data estilo 103',
  'SELECT CONVERT(VARCHAR(10), T0.DocDate, 103) FROM OINV T0',
  `SELECT TO_VARCHAR(T0."DocDate", 'DD/MM/YYYY') FROM "OINV" T0`);
t('subselect IN (SELECT...)',
  'SELECT T0.DocEntry FROM ORDR T0 WHERE T0.CardCode IN (SELECT T1.CardCode FROM OCRD T1)',
  null); /* só garante que não lança erro */
t('CASE WHEN preserva',
  "SELECT CASE WHEN T0.Status = 'O' THEN 'Aberto' ELSE 'Fechado' END AS St FROM OINV T0",
  null);
t('concatenação + → ||',
  "SELECT T0.FirstName + ' ' + T0.LastName FROM OHEM T0",
  `SELECT T0."FirstName" || ' ' || T0."LastName" FROM "OHEM" T0`);
t('bloco de comentário preservado',
  'SELECT T0.X /* nota WHERE bla */ FROM T',
  'SELECT T0."X" /* nota WHERE bla */ FROM "T"');

console.log('\n==================================');
console.log(`TOTAL: ${pass} pass, ${fail} fail`);
