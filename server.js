const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const querystring = require('querystring');
const pdf = require('pdf-parse');

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

app.post('/api/semapach', async (resBody, res) => {
  const { codigo } = resBody.body;
  if (!codigo) {
    return res.status(400).json({ success: false, message: 'El código de suministro es requerido.' });
  }

  console.log(`[Semapach] Consultando código de suministro: ${codigo}`);

  try {
    const postData = querystring.stringify({
      codigo: codigo,
      'btn-login': 'Consultar'
    });

    // 1. Post to login page. We disable automatic redirect following to capture cookies.
    let response = await axios.post('https://www.epssemapach.com.pe/consultaweb/', postData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      maxRedirects: 0,
      validateStatus: function (status) {
        return status >= 200 && status < 400; // Accept 302 redirect status
      },
      timeout: 15000
    });

    let html = response.data;
    let cookies = response.headers['set-cookie'] || [];
    let sessionCookie = formatCookieHeader(cookies);

    // 2. If it redirects (302) to home.php, login succeeded. Fetch home.php using the cookie.
    if (response.status === 302 || (response.headers.location && response.headers.location.includes('home.php'))) {
      const homeUrl = new URL(response.headers.location, 'https://www.epssemapach.com.pe/consultaweb/').toString();
      
      const homeResponse = await axios.get(homeUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': sessionCookie
        },
        timeout: 15000
      });
      html = homeResponse.data;
    }

    const $ = cheerio.load(html);

    // Check for error notifications (if we are still on login page with error text)
    const errorBlock = $('.notification_block, .error, .alert-danger');
    if (errorBlock.length > 0) {
      const errorText = errorBlock.text().replace(/\s+/g, ' ').trim();
      if (errorText.toLowerCase().includes('sin informacion') || errorText.toLowerCase().includes('error')) {
        return res.json({ success: false, message: `Semapach: ${errorText}` });
      }
    }

    // 3. Extract owner details from inputs in home.php
    let titular = $('#propietario').val();
    let direccion = $('#tdir').val();
    
    // Clean up mojibake if any
    titular = fixDoubleUtf8(titular);
    direccion = fixDoubleUtf8(direccion);

    // 4. Select the correct debt history table (it contains "periodo" or "recibo" in header)
    let targetTable = null;
    let maxCols = 0;
    
    $('table').each((i, tableEl) => {
      const headers = [];
      $(tableEl).find('tr').first().find('th, td').each((idx, cel) => {
        headers.push($(cel).text().toLowerCase().trim());
      });
      
      const isDebtTable = headers.some(h => h.includes('periodo') || h.includes('período') || h.includes('recibo'));
      // Filter out claims tables or others
      if (isDebtTable && headers.length > maxCols) {
        maxCols = headers.length;
        targetTable = $(tableEl);
      }
    });

    if (!targetTable) {
      // Check if it returned a warning about incorrect supply code
      const pageText = $('body').text();
      if (pageText.includes('código sin Informacion') || pageText.includes('sin Informacion')) {
        return res.json({ success: false, message: 'Semapach: Código de suministro sin información o incorrecto.' });
      }
      return res.json({ success: false, message: 'Semapach: No se encontraron datos para este código de suministro.' });
    }

    const rows = [];
    targetTable.find('tr').each((rowIndex, rowEl) => {
      const cells = [];
      $(rowEl).find('th, td').each((colIndex, cellEl) => {
        cells.push($(cellEl).text().replace(/\s+/g, ' ').trim());
      });
      rows.push(cells);
    });

    // If we only have headers, return empty list
    if (rows.length <= 1) {
      return res.json({ success: true, receipts: [], message: 'No se registran recibos pendientes de pago.' });
    }

    // 5. Format receipts and generate PDF links for each month
    const headers = rows[0].map(h => h.toLowerCase());
    const mesIndex = headers.findIndex(h => h.includes('mes') || h.includes('periodo') || h.includes('fecha'));
    const reciboIndex = headers.findIndex(h => h.includes('recibo') || h.includes('documento') || h.includes('nº') || h.includes('número') || h.includes('numero'));
    const vencimientoIndex = headers.findIndex(h => h.includes('vence') || h.includes('vencimiento') || h.includes('emisión') || h.includes('emision'));
    const importeIndex = headers.findIndex(h => h.includes('importe') || h.includes('monto') || h.includes('deuda') || h.includes('total') || h.includes('pagar'));
    const consumoIndex = headers.findIndex(h => h.includes('consumo') || h.includes('m3') || h.includes('metros'));

    const receipts = [];
    
    // Find the latest PDF link from the buttons on home.php if available (fallback)
    let defaultPdfUrl = null;
    $('a').each((i, linkEl) => {
      const href = $(linkEl).attr('href');
      if (href && (href.includes('recibo.php') || href.includes('pdf/recibos'))) {
        defaultPdfUrl = new URL(href, 'https://www.epssemapach.com.pe/consultaweb/').toString();
      }
    });

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Skip if row is empty or if it contains total row
      if (row.length < 3 || row.some(cell => cell.toLowerCase().includes('total'))) continue;

      const getVal = (idx, fallback) => {
        if (idx !== -1 && row[idx]) return row[idx];
        return fallback;
      };

      const mes = getVal(mesIndex !== -1 ? mesIndex : 1, 'N/A');
      const recibo = getVal(reciboIndex !== -1 ? reciboIndex : 2, 'N/A');
      const vencimiento = getVal(vencimientoIndex !== -1 ? vencimientoIndex : 3, 'N/A');
      const importe = getVal(importeIndex !== -1 ? importeIndex : 7, '0.00');
      const consumo = getVal(consumoIndex !== -1 ? consumoIndex : 6, 'N/A');

      // Generate the URL pattern for this month
      let pdfUrl = null;
      const periodMatch = mes.match(/([a-zA-Z\u00C0-\u017F]+)\s*-\s*(\d{4})/);
      if (periodMatch) {
        const monthName = periodMatch[1].toLowerCase().trim();
        const year = periodMatch[2];
        const monthMap = {
          enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
          julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
        };
        const monthNum = monthMap[monthName];
        if (monthNum) {
          pdfUrl = `https://www.epssemapach.com.pe/consultaweb/pdf/recibos/recibo.php?codcliente=${codigo}&anio=${year}&mes=${monthNum}`;
        }
      }

      // Fallback for latest month
      if (i === 1 && !pdfUrl) {
        pdfUrl = defaultPdfUrl;
      }

      receipts.push({
        mes,
        recibo,
        vencimiento,
        importe,
        consumo,
        pdfUrl
      });
    }

    return res.json({
      success: true,
      titular: titular || `Conexión: ${codigo}`,
      direccion: direccion || 'N/A',
      receipts: receipts.slice(0, 1)
    });

  } catch (error) {
    console.error('[Semapach Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: `Error de conexión con el servidor de Semapach: ${error.message}`,
      code: error.code,
      response: error.response ? { status: error.response.status, data: error.response.data } : null
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

