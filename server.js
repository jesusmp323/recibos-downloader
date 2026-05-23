const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const querystring = require('querystring');
const pdf = require('pdf-parse');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/ping', (req, res) => {
  res.json({ success: true, local: true });
});


// Helper to clean and format cookies for the Cookie header
function formatCookieHeader(cookieHeaders) {
  if (!cookieHeaders) return '';
  return cookieHeaders
    .map(cookie => cookie.split(';')[0])
    .join('; ');
}

// ----------------------------------------------------
// SEMAPACH API ENDPOINT
// ----------------------------------------------------
// Helper to fix double UTF-8 encoding (mojibake)
function fixDoubleUtf8(str) {
  if (!str) return '';
  try {
    return decodeURIComponent(escape(str));
  } catch (e) {
    // If it's not double-encoded, escape/decodeURIComponent might fail, so return original
    return str;
  }
}

app.post('/api/semapach', async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) {
    return res.status(400).json({ success: false, message: 'El código de suministro es requerido.' });
  }

  console.log(`[Semapach] Consultando código: ${codigo} vía Puppeteer...`);
  const SEMAPACH_URL = 'https://www.epssemapach.com.pe/consultaweb/';
  let browser = null;

  try {
    // Lanzar Chrome real en modo headless
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await browser.newPage();

    // Simular un navegador real
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-PE,es;q=0.9' });

    // Ocultar que es Puppeteer (evitar detección bot)
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // PASO 1: Abrir la página de login
    console.log('[Semapach] PASO 1 - Abriendo página de login...');
    await page.goto(SEMAPACH_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // PASO 2: Llenar el campo de código y enviar el formulario
    console.log('[Semapach] PASO 2 - Enviando código de suministro...');
    await page.waitForSelector('input[name="codigo"]', { timeout: 10000 });
    await page.type('input[name="codigo"]', codigo, { delay: 50 });
    await page.click('input[name="btn-login"], button[type="submit"], input[type="submit"]');

    // PASO 3: Esperar a que cargue la respuesta (home.php o error)
    console.log('[Semapach] PASO 3 - Esperando respuesta del servidor...');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {
      // Si no hay navegación, puede que el error se muestre en la misma página
      console.log('[Semapach] Sin navegación detectada, revisando página actual...');
    });

    // Obtener el HTML final de la página
    const html = await page.content();
    const currentUrl = page.url();
    console.log(`[Semapach] URL actual: ${currentUrl}`);

    await browser.close();
    browser = null;

    // PASO 4: Parsear los datos del HTML
    const $ = cheerio.load(html);

    // Verificar si hay mensaje de error
    const bodyText = $('body').text().toLowerCase();
    const errorBlock = $('.notification_block, .error, .alert-danger, .alert-warning');
    if (errorBlock.length > 0) {
      const errorText = errorBlock.text().replace(/\s+/g, ' ').trim();
      if (errorText.length > 0) {
        return res.json({ success: false, message: `Semapach: ${errorText}` });
      }
    }
    if (bodyText.includes('sin informacion') || bodyText.includes('sin información') || bodyText.includes('codigo incorrecto')) {
      return res.json({ success: false, message: 'Semapach: Código de suministro sin información o incorrecto.' });
    }

    // Extraer titular y dirección
    let titular = $('#propietario').val() || $('input[name="propietario"]').val() || '';
    let direccion = $('#tdir').val() || $('input[name="tdir"]').val() || '';
    titular = fixDoubleUtf8(titular);
    direccion = fixDoubleUtf8(direccion);
    console.log(`[Semapach] Titular: "${titular}", Dirección: "${direccion}"`);

    // Buscar la tabla de recibos/deudas
    let targetTable = null;
    let maxCols = 0;
    $('table').each((i, tableEl) => {
      const headerText = $(tableEl).find('tr').first().find('th, td').map((j, c) => $(c).text().toLowerCase().trim()).get().join(' ');
      const isDebtTable = headerText.includes('periodo') || headerText.includes('período') ||
                          headerText.includes('recibo') || headerText.includes('mes') ||
                          headerText.includes('vence') || headerText.includes('importe');
      const colCount = $(tableEl).find('tr').first().find('th, td').length;
      if (isDebtTable && colCount > maxCols) {
        maxCols = colCount;
        targetTable = $(tableEl);
      }
    });

    if (!targetTable) {
      if (titular) {
        return res.json({
          success: true,
          titular,
          direccion: direccion || 'N/A',
          receipts: [],
          message: 'No se registran recibos pendientes de pago.'
        });
      }
      return res.json({ success: false, message: 'Semapach: No se encontraron datos. Verifique el código de suministro.' });
    }

    // Extraer filas
    const rows = [];
    targetTable.find('tr').each((i, rowEl) => {
      const cells = $(rowEl).find('td, th').map((j, cell) => $(cell).text().replace(/\s+/g, ' ').trim()).get();
      if (cells.length > 0) rows.push(cells);
    });

    if (rows.length <= 1) {
      return res.json({
        success: true,
        titular: titular || `Conexión: ${codigo}`,
        direccion: direccion || 'N/A',
        receipts: [],
        message: 'No se registran recibos pendientes de pago.'
      });
    }

    // Mapear columnas dinámicamente
    const colHeaders = rows[0].map(h => h.toLowerCase());
    const mesIdx   = colHeaders.findIndex(h => h.includes('mes') || h.includes('periodo') || h.includes('fecha'));
    const reciboIdx= colHeaders.findIndex(h => h.includes('recibo') || h.includes('nº') || h.includes('numero'));
    const venceIdx = colHeaders.findIndex(h => h.includes('vence') || h.includes('vencimiento') || h.includes('emision') || h.includes('emisión'));
    const importeIdx=colHeaders.findIndex(h => h.includes('importe') || h.includes('monto') || h.includes('deuda') || h.includes('total') || h.includes('pagar'));
    const consumoIdx=colHeaders.findIndex(h => h.includes('consumo') || h.includes('m3'));
    const getCell = (row, idx, fallback) => (idx >= 0 && row[idx]) ? row[idx] : fallback;

    let defaultPdfUrl = null;
    $('a').each((i, linkEl) => {
      const href = $(linkEl).attr('href') || '';
      if (href.includes('recibo.php') || href.includes('pdf/recibos')) {
        defaultPdfUrl = new URL(href, SEMAPACH_URL).toString();
      }
    });

    const receipts = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 2 || row.join('').toLowerCase().includes('total')) continue;

      const mes        = getCell(row, mesIdx,    row[0] || 'N/A');
      const recibo     = getCell(row, reciboIdx, row[1] || 'N/A');
      const vencimiento= getCell(row, venceIdx,  row[2] || 'N/A');
      const importe    = getCell(row, importeIdx, row[row.length - 1] || '0.00');
      const consumo    = getCell(row, consumoIdx, 'N/A');

      let pdfUrl = null;
      const periodMatch = mes.match(/([a-zA-Z\u00C0-\u017F]+)\s*[-/]\s*(\d{4})/);
      if (periodMatch) {
        const monthName = periodMatch[1].toLowerCase().trim();
        const year = periodMatch[2];
        const monthMap = { enero:'01', febrero:'02', marzo:'03', abril:'04', mayo:'05', junio:'06',
                           julio:'07', agosto:'08', septiembre:'09', octubre:'10', noviembre:'11', diciembre:'12' };
        const monthNum = monthMap[monthName];
        if (monthNum) pdfUrl = `${SEMAPACH_URL}pdf/recibos/recibo.php?codcliente=${codigo}&anio=${year}&mes=${monthNum}`;
      }
      if (!pdfUrl && i === 1) pdfUrl = defaultPdfUrl;

      receipts.push({ mes, recibo, vencimiento, importe, consumo, pdfUrl });
    }

    return res.json({
      success: true,
      titular: titular || `Conexión: ${codigo}`,
      direccion: direccion || 'N/A',
      receipts: receipts.slice(0, 1)
    });

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error('[Semapach Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: `Error al consultar Semapach: ${error.message}`,
      code: error.code
    });
  }
});


// ----------------------------------------------------
// ELECTRODUNAS API ENDPOINTS
// ----------------------------------------------------

// 1. Initialise session and get Anti-forgery Token
app.get('/api/electrodunas/init', async (req, res) => {
  console.log('[Electrodunas] Iniciando sesión y obteniendo token de validación...');
  try {
    const response = await axios.get('https://www.electrodunas.com/ConsultaRecibo', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });

    const setCookies = response.headers['set-cookie'] || [];
    const formattedCookies = formatCookieHeader(setCookies);

    const html = response.data;
    const $ = cheerio.load(html);
    const verificationToken = $('input[name="__RequestVerificationToken"]').val();

    if (!verificationToken) {
      console.warn('[Electrodunas] Advertencia: No se encontró __RequestVerificationToken en el HTML.');
    }

    return res.json({
      success: true,
      token: verificationToken || '',
      cookies: formattedCookies
    });

  } catch (error) {
    console.error('[Electrodunas Init Error]:', error.message);
    return res.status(500).json({ success: false, message: 'Error al inicializar sesión con Electrodunas.' });
  }
});

// 2. Submit NIS + hCaptcha Token and Download PDF
app.post('/api/electrodunas/download', async (req, res) => {
  const { code, captchaResponse, token, cookies } = req.body;

  if (!code || !captchaResponse || !token || !cookies) {
    return res.status(400).json({
      success: false,
      message: 'Faltan parámetros requeridos: code, captchaResponse, token o cookies.'
    });
  }

  console.log(`[Electrodunas] Descargando recibo para NIS: ${code}`);

  try {
    const postData = querystring.stringify({
      code: code,
      'h-captcha-response': captchaResponse,
      __RequestVerificationToken: token
    });

    const response = await axios.post('https://www.electrodunas.com/ConsultaRecibo/Home/Download', postData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': cookies,
        'Origin': 'https://www.electrodunas.com',
        'Referer': 'https://www.electrodunas.com/ConsultaRecibo'
      },
      responseType: 'arraybuffer', // Ensure we receive PDF binary or raw redirect HTML
      timeout: 20000,
      validateStatus: function (status) {
        return status >= 200 && status < 400; // Accept redirects too
      }
    });

    const contentType = response.headers['content-type'] || '';
    
    // Check if Electrodunas returned HTML instead of PDF (typically indicates validation error)
    if (contentType.includes('text/html')) {
      const htmlString = Buffer.from(response.data).toString('utf-8');
      const $ = cheerio.load(htmlString);
      
      // Look for validation summaries or alerts
      let errorMessage = 'Error al consultar el recibo. Verifique el NIS e intente de nuevo.';
      const errorSummary = $('.validation-summary-errors, .alert-danger, .has-text-danger');
      if (errorSummary.length > 0) {
        errorMessage = errorSummary.text().replace(/\s+/g, ' ').trim();
      } else {
        // Check if there is some general body text error
        const textContent = $('body').text();
        if (textContent.includes('incorrecto') || textContent.includes('no válido') || textContent.includes('no encontrado')) {
          errorMessage = 'NIS incorrecto o sin información de recibo.';
        }
      }
      
      console.log(`[Electrodunas Query Fail]: ${errorMessage}`);
      return res.status(400).json({ success: false, message: `Electrodunas: ${errorMessage}` });
    }

    // If it is a PDF or generic octet-stream, stream it to client
    if (contentType.includes('pdf') || contentType.includes('octet-stream') || response.data.length > 5000) {
      console.log(`[Electrodunas] Recibo PDF obtenido correctamente. Tamaño: ${response.data.length} bytes.`);
      
      let amount = '0.00';
      try {
        const parsedPdf = await pdf(response.data);
        const cleanText = parsedPdf.text.replace(/\s+/g, ' ');
        console.log(`[PDF Parser] Extracted raw text length: ${cleanText.length} characters.`);
        console.log(`[PDF Parser] First 500 chars of extracted text: ${cleanText.substring(0, 500)}`);

        // Refined patterns to prioritize the barcode block and asterisk-filled security numbers
        const regexes = [
          new RegExp(`0\\.${code}\\.\\d{2}\\s*-\\s*\\d{2}/\\d{2}/\\d{2}\\s*(\\d+(?:\\.\\d{2})?)\\s*DV:\\s*\\d`, 'i'),
          /0\.\d{9}\.\d{2}\s*-\s*\d{2}\/\d{2}\/\d{2}\s*(\d+(?:\.\d{2})?)\s*DV:\s*\d/i,
          /\*{3,}\s*(\d+(?:\.\d{2})?)/,
          /total\s+del\s+mes\s*(\d+(?:\.\d{2})?)/i,
          /total\s+a\s+pagar\s*(?:s\/\.?\s*)?(\d+(?:\.\d{2})?)\b/i,
          /monto\s+a\s+pagar\s*(?:s\/\.?\s*)?(\d+(?:\.\d{2})?)\b/i
        ];

        for (const regex of regexes) {
          const match = cleanText.match(regex);
          if (match) {
            amount = match[1].replace(',', '.');
            console.log(`[PDF Parser] Extracted amount from PDF text: S/ ${amount} (using regex: ${regex})`);
            break;
          }
        }
      } catch (err) {
        console.error('[PDF Parser Error]: Failed to extract amount from PDF.', err.message);
      }

      res.setHeader('Access-Control-Expose-Headers', 'x-parsed-amount');
      res.setHeader('x-parsed-amount', amount);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=recibo-electrodunas-${code}.pdf`);
      return res.send(response.data);
    }

    // Default error fallback
    return res.status(500).json({
      success: false,
      message: 'Respuesta inesperada del servidor de Electrodunas. Por favor intente de nuevo.'
    });

  } catch (error) {
    console.error('[Electrodunas Download Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error al comunicarse con el servidor de Electrodunas para descargar el recibo.'
    });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`Servidor de Recibos ejecutándose en http://localhost:${PORT}`);
  console.log(`=======================================================`);
});

module.exports = app;

