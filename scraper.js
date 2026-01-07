const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

/**
 * Encuentra el ejecutable de Chrome
 */
function findChromeExecutable() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (fs.existsSync(envPath)) {
      console.log(`✓ Chrome encontrado en variable de entorno: ${envPath}`);
      return envPath;
    }
  }

  const possiblePaths = [
    puppeteer.executablePath?.(),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      console.log(`✓ Chrome encontrado en: ${chromePath}`);
      return chromePath;
    }
  }

  return null;
}

/**
 * Función principal para procesar un cliente
 */
async function procesarClienteAFIP(cuit, clave) {
  let browser = null;

  try {
    const chromeExecutable = findChromeExecutable();
    
    if (!chromeExecutable) {
      throw new Error('❌ No se encontró Chrome/Chromium instalado.');
    }

    browser = await puppeteer.launch({
      headless: process.env.PUPPETEER_HEADLESS !== 'false',
      executablePath: chromeExecutable,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`[${cuit}] Abriendo navegador e ingresando a AFIP...`);

    // 1. Abrir link
    await page.goto('https://auth.afip.gob.ar/contribuyente_/login.xhtml', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await sleep(2000);

    // 2. Click e ingresar CUIT
    console.log(`[${cuit}] Ingresando CUIT...`);
    await page.click('#F1\\:username');
    await page.type('#F1\\:username', cuit);
    await sleep(500);

    // 3. Click en Siguiente
    await page.click('#F1\\:btnSiguiente');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 4. Click e ingresar clave
    console.log(`[${cuit}] Ingresando clave...`);
    await page.click('#F1\\:password');
    await page.type('#F1\\:password', clave);
    await sleep(500);

    // 5. Click en Ingresar
    await page.click('#F1\\:btnIngresar');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(3000);

    // 6. Extraer nombre del usuario
    console.log(`[${cuit}] Extrayendo nombre del usuario...`);
    let nombreUsuario = 'No disponible';
    try {
      nombreUsuario = await page.$eval('strong.text-primary', el => el.textContent.trim());
      console.log(`[${cuit}] Nombre: ${nombreUsuario}`);
    } catch (e) {
      console.log(`[${cuit}] No se pudo extraer el nombre`);
    }

    // 7. Click en buscador y escribir "Mis Comprobantes"
    console.log(`[${cuit}] Buscando Mis Comprobantes...`);
    await page.click('#buscadorInput');
    await sleep(500);
    await page.type('#buscadorInput', 'Mis Comprobantes');
    await sleep(2000);

    // 8. Click en el resultado de búsqueda
    await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('.col-sm-9'));
      const resultado = divs.find(div => {
        const text = div.textContent;
        return text.includes('Mis Comprobantes') && text.includes('Consulta de Comprobantes Electrónicos');
      });
      if (resultado) {
        resultado.click();
      }
    });
    await sleep(3000);

    // 9. Esperar que se abra nueva pestaña
    console.log(`[${cuit}] Esperando nueva pestaña...`);
    const pages = await browser.pages();
    let nuevaPagina = pages[pages.length - 1];
    
    // Si no se abrió nueva pestaña, usar la actual
    if (pages.length === 1) {
      nuevaPagina = page;
    }

    // 10. Navegar a comprobantes emitidos en la nueva pestaña
    console.log(`[${cuit}] Navegando a comprobantes emitidos...`);
    await nuevaPagina.goto('https://fes.afip.gob.ar/mcmp/jsp/comprobantesEmitidos.do', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    await sleep(3000);

    // 11. Click en fechaEmision
    console.log(`[${cuit}] Seleccionando fecha...`);
    await nuevaPagina.click('#fechaEmision');
    await sleep(1000);

    // 12. Click en "Año Pasado"
    await nuevaPagina.click('li[data-range-key="Año Pasado"]');
    await sleep(1000);

    // 13. Click en Buscar
    await nuevaPagina.click('#buscarComprobantes');
    await sleep(3000);

    // 14. Click en icono de barras (menú de registros)
    console.log(`[${cuit}] Configurando vista de 50 registros...`);
    await nuevaPagina.click('.fa.fa-lg.fa-bars');
    await sleep(1000);

    // 15. Click en 50
    await nuevaPagina.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const link50 = links.find(a => a.textContent.trim() === '50');
      if (link50) link50.click();
    });
    await sleep(3000);

    // 16. Sumar fila por fila
    console.log(`[${cuit}] Comenzando suma de comprobantes...`);
    let totalFacturacion = 0.0;
    let hayPaginaSiguiente = true;
    let paginaActual = 1;

    while (hayPaginaSiguiente) {
      console.log(`[${cuit}] Procesando página ${paginaActual}...`);

      // Sumar en la página actual
      const { sumaPagina, filasProcesadas } = await nuevaPagina.evaluate(() => {
        let suma = 0.0;
        let procesadas = 0;
        
        const filas = document.querySelectorAll('tbody tr');

        filas.forEach(fila => {
          const cols = fila.querySelectorAll('td');
          if (cols.length < 2) return;

          let tipoComprobante = "";
          let importeTexto = "";
          
          cols.forEach(td => {
            const texto = td.textContent.trim();
            
            // Buscar tipo de comprobante
            if (texto.includes('Factura') || texto.includes('Nota de Crédito') || texto.includes('Nota de Débito')) {
              tipoComprobante = texto;
            }
            
            // Buscar importe (columna Imp. Total)
            if (td.classList.contains('alignRight') && texto.includes('$')) {
              importeTexto = texto;
            }
          });

          if (tipoComprobante && importeTexto) {
            // Limpiar importe: 120.000,00 -> 120000.00
            const importeLimpio = importeTexto
              .replace('$', '')
              .replace(/\s/g, '')
              .replace(/\./g, '')
              .replace(',', '.')
              .trim();
            
            const importe = parseFloat(importeLimpio);

            if (!isNaN(importe)) {
              if (tipoComprobante.includes('Factura')) {
                suma += importe;
              } else if (tipoComprobante.includes('Nota de Crédito')) {
                suma -= importe;
              } else if (tipoComprobante.includes('Nota de Débito')) {
                suma += importe;
              }
              procesadas++;
            }
          }
        });

        return { sumaPagina: suma, filasProcesadas: procesadas };
      });

      totalFacturacion += sumaPagina;
      console.log(`[${cuit}] Página ${paginaActual}: ${filasProcesadas} filas. Acumulado: $${totalFacturacion.toLocaleString('es-AR', {minimumFractionDigits: 2})}`);

      // 17. Verificar si hay página siguiente
      const existeSiguiente = await nuevaPagina.evaluate(() => {
        const botones = Array.from(document.querySelectorAll('a[aria-controls="tablaDataTables"]'));
        const btnSiguiente = botones.find(b => b.textContent.trim() === '»');
        
        if (!btnSiguiente) return false;
        
        const parentLi = btnSiguiente.closest('li');
        if (parentLi && parentLi.classList.contains('disabled')) return false;
        if (btnSiguiente.classList.contains('disabled')) return false;
        
        btnSiguiente.click();
        return true;
      });

      if (existeSiguiente) {
        paginaActual++;
        await sleep(2000);
      } else {
        hayPaginaSiguiente = false;
      }
    }

    // 18. Totalizar
    const montoFacturas = totalFacturacion.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    console.log(`[${cuit}] ✓ Total Facturación Emitida: $${montoFacturas}`);

    return {
      cuit: cuit,
      nombre: nombreUsuario,
      facturasEmitidas: montoFacturas,
      timestamp: new Date().toISOString(),
      loginExitoso: true
    };

  } catch (error) {
    console.error(`[${cuit}] ✗ Error:`, error.message);
    throw error;

  } finally {
    if (browser) {
      await browser.close();
      console.log(`[${cuit}] Navegador cerrado`);
    }
  }
}

/**
 * Utilidad para esperar
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  procesarClienteAFIP,
  sleep
};
