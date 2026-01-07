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

    // Configuración del navegador
    browser = await puppeteer.launch({
      headless: process.env.PUPPETEER_HEADLESS !== 'false',
      executablePath: chromeExecutable,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await browser.newPage();

    // Configurar viewport y user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Ocultar que es un bot
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['es-AR', 'es', 'en']
      });
    });

    console.log(`[${cuit}] Navegando a AFIP...`);

    // ============================================
    // PASO 1: NAVEGAR A LA PÁGINA DE LOGIN
    // ============================================
    await page.goto('https://auth.afip.gob.ar/contribuyente_/login.xhtml', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log(`[${cuit}] Página de login cargada`);
    await sleep(1000 + Math.random() * 1000);

    // ============================================
    // PASO 2: INGRESAR CUIT
    // ============================================
    console.log(`[${cuit}] Ingresando CUIT...`);
    await page.waitForSelector('#F1\\:username', { timeout: 10000 });
    await page.click('#F1\\:username');
    await sleep(300);
    await page.type('#F1\\:username', cuit, { delay: 50 + Math.random() * 50 });
    await sleep(500 + Math.random() * 500);
    await page.click('#F1\\:btnSiguiente');

    console.log(`[${cuit}] CUIT ingresado, esperando página de contraseña...`);
    await page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // ============================================
    // PASO 3: INGRESAR CONTRASEÑA
    // ============================================
    console.log(`[${cuit}] Ingresando contraseña...`);
    await page.waitForSelector('#F1\\:password', { timeout: 10000 });
    await page.click('#F1\\:password');
    await sleep(300);
    await page.type('#F1\\:password', clave, { delay: 50 + Math.random() * 50 });
    await sleep(500 + Math.random() * 500);
    await page.click('#F1\\:btnIngresar');

    console.log(`[${cuit}] Contraseña ingresada, esperando dashboard...`);
    await page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await sleep(2000);

    // ============================================
    // PASO 4: VERIFICAR LOGIN EXITOSO
    // ============================================
    const loginExitoso = await verificarLoginExitoso(page);

    if (!loginExitoso) {
      throw new Error('Login fallido - Verificar credenciales');
    }

    console.log(`[${cuit}] ✓ Login exitoso`);
    await sleep(2000);

    // ============================================
    // PASO 5: EXTRAER NOMBRE DEL USUARIO
    // ============================================
    console.log(`[${cuit}] Extrayendo nombre del usuario...`);
    let nombreUsuario = 'No disponible';
    
    try {
      nombreUsuario = await page.evaluate(() => {
        const elemento = document.querySelector('strong.text-primary');
        return elemento ? elemento.textContent.trim() : null;
      });
      
      if (nombreUsuario) {
        console.log(`[${cuit}] Nombre extraído: ${nombreUsuario}`);
      } else {
        console.log(`[${cuit}] No se pudo encontrar el nombre del usuario`);
      }
    } catch (e) {
      console.log(`[${cuit}] Error extrayendo nombre:`, e.message);
    }

    await sleep(2000);

    // ============================================
    // PASO 6: NAVEGAR A SETEAR CONTRIBUYENTE (MISMA PESTAÑA)
    // ============================================
    console.log(`[${cuit}] Navegando a setearContribuyente...`);
    await page.goto('https://fes.afip.gob.ar/mcmp/jsp/setearContribuyente.do?idContribuyente=0', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    await sleep(3000);
    
    // Verificar URL
    console.log(`[${cuit}] URL después de setearContribuyente: ${page.url()}`);

    // ============================================
    // PASO 7: NAVEGAR A COMPROBANTES EMITIDOS
    // ============================================
    console.log(`[${cuit}] Navegando a comprobantesEmitidos...`);
    await page.goto('https://fes.afip.gob.ar/mcmp/jsp/comprobantesEmitidos.do', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    await sleep(5000); // Espera más larga para asegurar que cargue

    // Verificar URL y título
    const urlComprobantes = page.url();
    const tituloComprobantes = await page.title();
    console.log(`[${cuit}] URL comprobantes: ${urlComprobantes}`);
    console.log(`[${cuit}] Título página: ${tituloComprobantes}`);
    
    // Verificar si la sesión expiró
    if (tituloComprobantes.toLowerCase().includes('sesión') || tituloComprobantes.toLowerCase().includes('expirado')) {
      throw new Error('Sesión expirada al navegar a comprobantes. Título: ' + tituloComprobantes);
    }

    // Verificar si existe el elemento fechaEmision
    console.log(`[${cuit}] Verificando si existe #fechaEmision...`);
    const fechaExiste = await page.$('#fechaEmision');
    
    if (!fechaExiste) {
      console.log(`[${cuit}] ❌ #fechaEmision NO encontrado`);
      
      // Diagnóstico: ver qué inputs hay en la página
      const inputsDisponibles = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        return inputs.map(i => ({
          id: i.id,
          name: i.name,
          type: i.type,
          class: i.className
        })).slice(0, 10);
      });
      
      console.log(`[${cuit}] Inputs disponibles:`, JSON.stringify(inputsDisponibles, null, 2));
      
      // Tomar screenshot
      try {
        await page.screenshot({
          path: `/app/error_no_fecha_${cuit}_${Date.now()}.png`,
          fullPage: true
        });
        console.log(`[${cuit}] Screenshot guardado en /app/`);
      } catch (e) {
        console.log(`[${cuit}] No se pudo guardar screenshot`);
      }
      
      throw new Error('#fechaEmision no encontrado. Ver screenshot y logs.');
    }

    // ============================================
    // PASO 8: CLICK EN FECHA EMISION
    // ============================================
    console.log(`[${cuit}] Seleccionando fecha...`);
    await page.click('#fechaEmision');
    await sleep(1500);

    // ============================================
    // PASO 9: CLICK EN "AÑO PASADO"
    // ============================================
    await page.click('li[data-range-key="Año Pasado"]');
    await sleep(1500);

    // ============================================
    // PASO 10: CLICK EN BUSCAR
    // ============================================
    await page.click('#buscarComprobantes');
    await sleep(4000);

    // ============================================
    // PASO 11: CONFIGURAR 50 REGISTROS
    // ============================================
    console.log(`[${cuit}] Configurando vista de 50 registros...`);
    await page.click('.fa.fa-lg.fa-bars');
    await sleep(1500);

    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const link50 = links.find(a => a.textContent.trim() === '50');
      if (link50) link50.click();
    });
    await sleep(4000);

    // ============================================
    // PASO 12: SUMAR FILA POR FILA
    // ============================================
    console.log(`[${cuit}] Comenzando suma de comprobantes...`);
    let totalFacturacion = 0.0;
    let hayPaginaSiguiente = true;
    let paginaActual = 1;

    while (hayPaginaSiguiente) {
      console.log(`[${cuit}] Procesando página ${paginaActual}...`);

      const { sumaPagina, filasProcesadas } = await page.evaluate(() => {
        let suma = 0.0;
        let procesadas = 0;
        
        const filas = document.querySelectorAll('#tablaDataTables tbody tr');

        filas.forEach(fila => {
          const cols = fila.querySelectorAll('td');
          if (cols.length < 2) return;

          let tipoComprobante = "";
          let importeTexto = "";
          
          cols.forEach(td => {
            const texto = td.textContent.trim();
            
            if (texto.includes('Factura') || texto.includes('Nota de Crédito') || texto.includes('Nota de Débito') || texto.includes('Recibo')) {
              tipoComprobante = texto;
            }
            
            if (td.classList.contains('alignRight') && texto.includes('$')) {
              importeTexto = texto;
            }
          });

          if (tipoComprobante && importeTexto) {
            const importeLimpio = importeTexto
              .replace('$', '')
              .replace(/\s/g, '')
              .replace(/\./g, '')
              .replace(',', '.')
              .trim();
            
            const importe = parseFloat(importeLimpio);

            if (!isNaN(importe)) {
              if (tipoComprobante.includes('Factura') || tipoComprobante.includes('Recibo')) {
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

      // ============================================
      // PASO 13: VERIFICAR PÁGINA SIGUIENTE
      // ============================================
      const existeSiguiente = await page.evaluate(() => {
        const botones = Array.from(document.querySelectorAll('.paginate_button, .pagination a, li a'));
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
        await sleep(3000);
      } else {
        hayPaginaSiguiente = false;
      }
    }

    // ============================================
    // PASO 14: TOTALIZAR
    // ============================================
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
 * Verifica si el login fue exitoso
 */
async function verificarLoginExitoso(page) {
  try {
    const urlActual = page.url();
    console.log(`URL después del login: ${urlActual}`);

    if (urlActual.includes('login') || urlActual.includes('error')) {
      return false;
    }

    const elementosExitosos = [
      'a[href*="logout"]',
      '.usuario-logueado',
      '#menu-principal',
      'a[title*="Salir"]',
      '.navbar-user'
    ];

    for (const selector of elementosExitosos) {
      const elemento = await page.$(selector);
      if (elemento) {
        console.log(`Login verificado con selector: ${selector}`);
        return true;
      }
    }

    return !urlActual.includes('login');

  } catch (error) {
    console.error('Error verificando login:', error.message);
    return false;
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
