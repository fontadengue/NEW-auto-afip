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

    // Cerrar la primera pestaña en blanco
    const pages = await browser.pages();
    if (pages.length > 1 && pages[0].url() === 'about:blank') {
      await pages[0].close();
      console.log(`[${cuit}] Pestaña en blanco cerrada`);
    }

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
    await sleep(7000);

    // ============================================
    // PASO 2: INGRESAR CUIT
    // ============================================
    console.log(`[${cuit}] Ingresando CUIT...`);
    await page.waitForSelector('#F1\\:username', { timeout: 10000 });
    await page.click('#F1\\:username');
    await sleep(7000);
    await page.type('#F1\\:username', cuit, { delay: 50 + Math.random() * 50 });
    await sleep(7000);
    await page.click('#F1\\:btnSiguiente');

    console.log(`[${cuit}] CUIT ingresado, esperando campo de contraseña...`);

    // ============================================
    // PASO 3: INGRESAR CONTRASEÑA
    // ============================================
    console.log(`[${cuit}] Ingresando contraseña...`);
    
    // Esperar directamente a que aparezca el campo de contraseña
    await page.waitForSelector('#F1\\:password', { visible: true, timeout: 30000 });
    await page.click('#F1\\:password');
    await sleep(7000);
    await page.type('#F1\\:password', clave, { delay: 50 + Math.random() * 50 });
    await sleep(7000);
    await page.click('#F1\\:btnIngresar');

    console.log(`[${cuit}] Contraseña ingresada, esperando dashboard...`);
    await page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await sleep(7000);

    // ============================================
    // PASO 4: VERIFICAR LOGIN EXITOSO
    // ============================================
    const loginExitoso = await verificarLoginExitoso(page);

    if (!loginExitoso) {
      throw new Error('Login fallido - Verificar credenciales');
    }

    console.log(`[${cuit}] ✓ Login exitoso`);
    await sleep(7000);

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

    await sleep(7000);

    // ============================================
    // PASO 6: BUSCAR "MIS COMPROBANTES"
    // ============================================
    console.log(`[${cuit}] Buscando "Mis Comprobantes"...`);
    
    // Click en el buscador
    await page.waitForSelector('#buscadorInput', { timeout: 10000 });
    await page.click('#buscadorInput');
    await sleep(7000);
    
    // Escribir "Mis Comprobantes"
    await page.type('#buscadorInput', 'Mis Comprobantes');
    await sleep(7000);
    
    // Click en el resultado "Mis Comprobantes"
    console.log(`[${cuit}] Haciendo click en resultado...`);
    await page.waitForSelector('p.small.text-muted', { timeout: 5000 });
    
    // Buscar el elemento que contiene exactamente "Mis Comprobantes"
    await page.evaluate(() => {
      const elementos = Array.from(document.querySelectorAll('p.small.text-muted'));
      const miComprobantes = elementos.find(el => el.textContent.trim() === 'Mis Comprobantes');
      if (miComprobantes) {
        miComprobantes.click();
      }
    });
    await sleep(7000);

    // ============================================
    // PASO 7: NAVEGAR A COMPROBANTES EMITIDOS (MISMA PESTAÑA)
    // ============================================
    console.log(`[${cuit}] Navegando a comprobantesEmitidos.do...`);
    await page.goto('https://fes.afip.gob.ar/mcmp/jsp/comprobantesEmitidos.do', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    await sleep(7000);
    
    // Cerrar otras pestañas abiertas
    const paginasAbiertas = await browser.pages();
    for (const p of paginasAbiertas) {
      if (p !== page) {
        await p.close();
      }
    }
    console.log(`[${cuit}] Otras pestañas cerradas`);
    
    await sleep(7000);
    
    // Verificar URL actual
    const urlEmitidos = page.url();
    console.log(`[${cuit}] URL Emitidos: ${urlEmitidos}`);

    // ============================================
    // PASO 8: CLICK EN FECHA EMISION
    // ============================================
    console.log(`[${cuit}] Seleccionando fecha...`);
    await page.click('#fechaEmision');
    await sleep(7000);

    // ============================================
    // PASO 9: CLICK EN "AÑO PASADO"
    // ============================================
    await page.click('li[data-range-key="Año Pasado"]');
    await sleep(7000);

    // ============================================
    // PASO 10: CLICK EN BUSCAR
    // ============================================
    await page.click('#buscarComprobantes');
    await sleep(7000);

    // ============================================
    // PASO 11: CONFIGURAR 50 REGISTROS
    // ============================================
    console.log(`[${cuit}] Configurando vista de 50 registros...`);
    await page.click('.fa.fa-lg.fa-bars');
    await sleep(7000);

    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const link50 = links.find(a => a.textContent.trim() === '50');
      if (link50) link50.click();
    });
    await sleep(7000);

    // ============================================
    // PASO 12: SUMAR FILA POR FILA
    // ============================================
    console.log(`[${cuit}] Comenzando suma de comprobantes...`);
    let totalFacturacion = 0.0;
    let hayPaginaSiguiente = true;
    let numeroPagina = 1;

    while (hayPaginaSiguiente) {
      console.log(`[${cuit}] Procesando página ${numeroPagina}...`);

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
      console.log(`[${cuit}] Página ${numeroPagina}: ${filasProcesadas} filas. Acumulado: $${totalFacturacion.toLocaleString('es-AR', {minimumFractionDigits: 2})}`);

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
        numeroPagina++;
        await sleep(7000);
      } else {
        hayPaginaSiguiente = false;
      }
    }

    // ============================================
    // PASO 14: TOTALIZAR EMITIDOS
    // ============================================
    const montoEmitidas = totalFacturacion.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    console.log(`[${cuit}] ✓ Total Facturación Emitida: $${montoEmitidas}`);

    // ============================================
    // PASO 15: ABRIR NUEVA PESTAÑA PARA COMPROBANTES RECIBIDOS
    // ============================================
    console.log(`[${cuit}] Procesando Comprobantes Recibidos...`);
    
    const nuevaPaginaRecibidos = await browser.newPage();
    await nuevaPaginaRecibidos.setViewport({ width: 1920, height: 1080 });
    
    // Copiar cookies
    const cookiesActuales = await page.cookies();
    await nuevaPaginaRecibidos.setCookie(...cookiesActuales);
    await sleep(7000);
    
    // Cerrar pestañas anteriores
    const todasLasPaginas = await browser.pages();
    for (const p of todasLasPaginas) {
      if (p !== nuevaPaginaRecibidos) {
        await p.close();
      }
    }
    console.log(`[${cuit}] Pestañas anteriores cerradas`);
    
    // Navegar a Comprobantes Recibidos
    console.log(`[${cuit}] Navegando a comprobantesRecibidos.do...`);
    await nuevaPaginaRecibidos.goto('https://fes.afip.gob.ar/mcmp/jsp/comprobantesRecibidos.do', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    await sleep(7000);
    
    console.log(`[${cuit}] URL Recibidos: ${nuevaPaginaRecibidos.url()}`);

    // ============================================
    // PASO 16: CLICK EN FECHA EMISION (RECIBIDOS)
    // ============================================
    console.log(`[${cuit}] Seleccionando fecha para Recibidos...`);
    await nuevaPaginaRecibidos.click('#fechaEmision');
    await sleep(7000);

    // ============================================
    // PASO 17: CLICK EN "AÑO PASADO" (RECIBIDOS)
    // ============================================
    await nuevaPaginaRecibidos.click('li[data-range-key="Año Pasado"]');
    await sleep(7000);

    // ============================================
    // PASO 18: CLICK EN BUSCAR (RECIBIDOS)
    // ============================================
    await nuevaPaginaRecibidos.click('#buscarComprobantes');
    await sleep(7000);

    // ============================================
    // PASO 19: CONFIGURAR 50 REGISTROS (RECIBIDOS)
    // ============================================
    console.log(`[${cuit}] Configurando vista de 50 registros para Recibidos...`);
    await nuevaPaginaRecibidos.click('.fa.fa-lg.fa-bars');
    await sleep(7000);

    await nuevaPaginaRecibidos.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const link50 = links.find(a => a.textContent.trim() === '50');
      if (link50) link50.click();
    });
    await sleep(7000);

    // ============================================
    // PASO 20: SUMAR FILA POR FILA (RECIBIDOS)
    // ============================================
    console.log(`[${cuit}] Comenzando suma de comprobantes Recibidos...`);
    let totalRecibidos = 0.0;
    let hayPaginaSiguienteRecibidos = true;
    let numeroPaginaRecibidos = 1;

    while (hayPaginaSiguienteRecibidos) {
      console.log(`[${cuit}] Procesando página ${numeroPaginaRecibidos} (Recibidos)...`);

      const { sumaPagina, filasProcesadas } = await nuevaPaginaRecibidos.evaluate(() => {
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

      totalRecibidos += sumaPagina;
      console.log(`[${cuit}] Página ${numeroPaginaRecibidos}: ${filasProcesadas} filas. Acumulado Recibidos: $${totalRecibidos.toLocaleString('es-AR', {minimumFractionDigits: 2})}`);

      // ============================================
      // PASO 21: VERIFICAR PÁGINA SIGUIENTE (RECIBIDOS)
      // ============================================
      const existeSiguiente = await nuevaPaginaRecibidos.evaluate(() => {
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
        numeroPaginaRecibidos++;
        await sleep(7000);
      } else {
        hayPaginaSiguienteRecibidos = false;
      }
    }

    // ============================================
    // PASO 22: TOTALIZAR RECIBIDOS
    // ============================================
    const montoRecibidas = totalRecibidos.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    console.log(`[${cuit}] ✓ Total Comprobantes Recibidos: $${montoRecibidas}`);

    return {
      cuit: cuit,
      nombre: nombreUsuario,
      facturasEmitidas: montoEmitidas,
      comprobantesRecibidos: montoRecibidas,
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
