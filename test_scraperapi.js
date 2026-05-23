const axios = require('axios');
const querystring = require('querystring');
const cheerio = require('cheerio');

async function test() {
  const apiKey = '1706a86227c83a88cc16c083d2d6b02b';
  const targetUrl = 'https://www.epssemapach.com.pe/consultaweb/';
  const postData = querystring.stringify({ codigo: '34054', 'btn-login': 'Consultar' });

  console.log('Sending request to ScraperAPI...');
  try {
    const scraperUrl = `http://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&keep_headers=true`;
    const response = await axios.post(scraperUrl, postData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 30000
    });

    console.log('Response Status:', response.status);
    const html = response.data.toString();
    const $ = cheerio.load(html);
    
    const titular = $('#propietario').val();
    const direccion = $('#tdir').val();
    console.log('--- SCRAPERAPI TEST RESULTS ---');
    console.log('Titular:', titular);
    console.log('Direccion:', direccion);
    
    // Print first 200 chars of body to check if we got blocked or the correct page
    console.log('Body snippet:', html.substring(0, 200));
  } catch (e) {
    console.error('Error during ScraperAPI query:', e.message);
    if (e.response) {
      console.error('Response status:', e.response.status);
      console.error('Response data:', e.response.data.toString());
    }
  }
}

test();
