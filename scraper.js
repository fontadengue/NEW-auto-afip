const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

/**
 * Encuentra el ejecutable de Chrome en diferentes ubicaciones
 */
function findChromeExecutable() {
  // Prioridad 1: Variable de entorno (Docker)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (fs.existsSync(envPath)) {
      console.log(`✓ Chrome encontrado en variable de entorno: ${envPath}`);
      return envPath;
    }
  }

  const possiblePaths = [
    // Ubicación de puppeteer.executablePath()
    puppeteer.executablePath?.(),
    // Chromium del sistema (común en Docker y Linux)
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    // Ubicación en .cache (nueva estructura)
    path.join(__dirname, '.cache', 'puppeteer', 'chrome'),
    path.join(__dirname, 'node_modules', 'puppeteer', '.local-chromium'),
    // Ubicaciones comunes en Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    // Ubicaciones comunes en Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // Ubicaciones comunes en Mac
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      console.log(`✓ Chrome encontrado en: ${chromePath}`);
      return chromePath;
    }
    
    // Si es un directorio, buscar el ejecutable dentro
    try {
      if (fs.statSync(chromePath).isDirectory()) {
        const files = fs.readdirSync(chromePath, { recursive: true });
        const executable = files.find(f => 
          f.includes('chrome') || f.includes('chromium')
        );
        if (executable) {
          const fullPath = path.join(chromePath, executable);
          if (fs.existsSync(fullPath)) {
            console.log(`✓ Chrome encontrado en: ${fullPath}`);
            return fullPath;
          }
        }
      }
    } catch (e) {
      // Ignorar errores de lectura de directorio
    }
  }

  return null;
}

/**
 * Función principal para procesar un cliente en AFIP/ARCA
 * @param {string} cuit - CUIT del cliente
 * @param {string} clave - Clave de acceso
 * @returns {Object} - Datos extraídos
 */
async function procesarClienteAFIP(cuit, clave) {
  let browser = null;

  try {
    // Buscar Chrome
    const chromeExecutable = findChromeExecutable();
    
    if (!chromeExecutable) {
      throw new Error(
        '❌ No se encontró Chrome/Chromium instalado.\n' +
        'Por favor ejecuta: npm run install-chrome\n' +
        'O manualmente: npx puppeteer browsers install chrome'
      );
    }

    // Configuración del navegador
    browser = await puppeteer.launch({
      headless: process.env.PUPPETEER_HEADLESS !== 'false', // Cambiar a false para debugging
      executablePath: chromeExecutable, // Usar el Chrome encontrado
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

    // Esperar un momento para simular comportamiento humano
    await sleep(1000 + Math.random() * 1000);

    // ============================================
    // PASO 2: INGRESAR CUIT
    // ============================================
    console.log(`[${cuit}] Ingresando CUIT...`);

    await page.waitForSelector('#F1\\:username', { timeout: 10000 });

    // Tipear con delay aleatorio para simular humano
    await page.click('#F1\\:username');
    await sleep(300);
    await page.type('#F1\\:username', cuit, { delay: 50 + Math.random() * 50 });

    await sleep(500 + Math.random() * 500);

    // Click en "Siguiente"
    await page.click('#F1\\:btnSiguiente');

    console.log(`[${cuit}] CUIT ingresado, esperando página de contraseña...`);

    // Esperar a que cargue la página de contraseña
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

    // Click en "Ingresar"
    await page.click('#F1\\:btnIngresar');

    console.log(`[${cuit}] Contraseña ingresada, esperando dashboard...`);

    // Esperar a que cargue el dashboard
    await page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Esperar un poco más para asegurar que todo cargó
    await sleep(2000);

    // ============================================
    // PASO 4: VERIFICAR LOGIN EXITOSO
    // ============================================
    const loginExitoso = await verificarLoginExitoso(page);

    if (!loginExitoso) {
      // Tomar screenshot para debugging
      try {
        await page.screenshot({
          path: `error_login_${cuit}_${Date.now()}.png`,
          fullPage: true
        });
      } catch (e) {
        console.error(`[${cuit}] No se pudo tomar screenshot:`, e.message);
      }

      throw new Error('Login fallido - Verificar credenciales');
    }

    console.log(`[${cuit}] ✓ Login exitoso`);

    // ============================================
    // PASO 5: NAVEGAR A LA SECCIÓN ESPECÍFICA
    // ============================================
    console.log(`[${cuit}] Navegando a sección objetivo...`);

    await sleep(2000); // Espera de seguridad

    // ============================================
    // PASO 6: EXTRAER DATOS
    // ============================================
    console.log(`[${cuit}] Extrayendo datos...`);

    const datosExtraidos = await extraerDatos(page, cuit);

    console.log(`[${cuit}] ✓ Datos extraídos exitosamente`);

    return datosExtraidos;

  } catch (error) {
    console.error(`[${cuit}] ✗ Error:`, error.message);

    // Intentar tomar screenshot del error si el browser sigue vivo
    try {
      if (browser) {
        const pages = await browser.pages();
        if (pages.length > 0) {
          await pages[0].screenshot({
            path: `error_${cuit}_${Date.now()}.png`,
            fullPage: true
          });
        }
      }
    } catch (e) {
      // Ignorar errores al tomar screenshot
    }

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

    // Verificación 1: La URL no debe contener "login" o "error"
    if (urlActual.includes('login') || urlActual.includes('error')) {
      return false;
    }

    // Verificación 2: Buscar elementos que indican login exitoso
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

    // Si llegamos aquí y la URL cambió, asumimos que el login fue exitoso
    return !urlActual.includes('login');

  } catch (error) {
    console.error('Error verificando login:', error.message);
    return false;
  }
}

/**
 * Función para extraer datos de la página
 */
async function extraerDatos(page, cuit) {
  try {
    let nombreUsuario = 'No disponible';
    let montoFacturas = 'No calculado';

    // ============================================
    // EXTRAER NOMBRE DEL USUARIO
    // ============================================
    try {
      console.log(`[${cuit}] Extrayendo nombre del usuario...`);
      
      const posiblesSelectoresNombre = [
        '.usuario-logueado',
        '.navbar-user',
        '[class*="usuario"]',
        '[class*="nombre"]'
      ];

      for (const selector of posiblesSelectoresNombre) {
        const nombre = await getTextSafe(page, selector);
        if (nombre) {
          nombreUsuario = nombre;
          console.log(`[${cuit}] Nombre encontrado: ${nombreUsuario}`);
          break;
        }
      }

      if (nombreUsuario === 'No disponible') {
        console.log(`[${cuit}] No se pudo encontrar el nombre del usuario`);
      }
    } catch (error) {
      console.error(`[${cuit}] Error extrayendo nombre:`, error.message);
    }

    // ============================================
    // CALCULAR FACTURACIÓN
    // ============================================
    try {
      console.log(`[${cuit}] Abriendo comprobantes en nueva pestaña...`);
      
      // En lugar de navegar (que cierra la sesión), abrir en nueva pestaña
      const nuevaPagina = await browser.newPage();
      
      // Configurar la nueva página igual que la original
      await nuevaPagina.setViewport({ width: 1920, height: 1080 });
      await nuevaPagina.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Copiar cookies de la página principal a la nueva
      const cookies = await page.cookies();
      await nuevaPagina.setCookie(...cookies);
      
      console.log(`[${cuit}] Navegando a setearContribuyente en nueva pestaña...`);
      await nuevaPagina.goto('https://fes.afip.gob.ar/mcmp/jsp/setearContribuyente.do?idContribuyente=0', {
        waitUntil: 'networkidle2',
        timeout: 45000
      });
      await sleep(2000);

      console.log(`[${cuit}] Navegando a comprobantesEmitidos en nueva pestaña...`);
      await nuevaPagina.goto('https://fes.afip.gob.ar/mcmp/jsp/comprobantesEmitidos.do', {
        waitUntil: 'networkidle2',
        timeout: 45000
      });
      await sleep(5000);
      
      // Desde ahora usamos la nueva página
      page = nuevaPagina;

      // ============================================
      // DIAGNOSTICAR LA PÁGINA
      // ============================================
      console.log(`[${cuit}] Diagnosticando página...`);
      
      const diagnostico = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          // Buscar todos los inputs
          todosLosInputs: Array.from(document.querySelectorAll('input')).map(i => ({
            id: i.id,
            name: i.name,
            type: i.type,
            class: i.className,
            visible: i.offsetParent !== null
          })),
          // Buscar específicamente fechaEmision
          fechaEmisionExiste: !!document.querySelector('#fechaEmision'),
          fechaEmisionVisible: document.querySelector('#fechaEmision')?.offsetParent !== null,
          // Buscar elementos con "fecha" en el id
          elementosConFecha: Array.from(document.querySelectorAll('[id*="fecha"], [name*="fecha"]')).map(e => ({
            tag: e.tagName,
            id: e.id,
            name: e.getAttribute('name'),
            class: e.className
          })),
          // Ver si hay algún formulario
          formularios: Array.from(document.querySelectorAll('form')).map(f => ({
            id: f.id,
            name: f.name,
            action: f.action
          })),
          // HTML de los primeros inputs de texto
          htmlInputsTexto: Array.from(document.querySelectorAll('input[type="text"]'))
            .slice(0, 5)
            .map(i => i.outerHTML),
          // Buscar mensajes de error o sesión expirada
          textosPagina: document.body.textContent.toLowerCase().includes('sesión') ? 
            document.body.textContent.substring(0, 500) : null
        };
      });
      
      console.log(`[${cuit}] 📊 DIAGNÓSTICO COMPLETO:`);
      console.log(JSON.stringify(diagnostico, null, 2));
      
      // Verificar si la sesión expiró
      if (diagnostico.title.toLowerCase().includes('expirado') || 
          diagnostico.title.toLowerCase().includes('sesión')) {
        throw new Error(`Sesión expirada en AFIP. Título: "${diagnostico.title}". La navegación directa a URLs no mantiene la sesión activa.`);
      }
      
      // Tomar screenshot para ver visualmente
      try {
        await page.screenshot({
          path: `/app/diagnostico_${cuit}_${Date.now()}.png`,
          fullPage: true
        });
        console.log(`[${cuit}] 📸 Screenshot guardado`);
      } catch (e) {
        console.log(`[${cuit}] ⚠️  No se pudo guardar screenshot`);
      }

      // ============================================
      // FILTRAR POR "AÑO PASADO"
      // ============================================
      console.log(`[${cuit}] Filtrando por 'Año Pasado'...`);
      
      // Intentar esperar a que el formulario esté completamente cargado
      await sleep(2000);
      
      // Click en: <input type="text" class="form-control" id="fechaEmision" required="">
      console.log(`[${cuit}] Buscando selector #fechaEmision...`);
      
      // Verificar si existe primero
      const fechaEmisionExiste = await page.evaluate(() => {
        const input = document.querySelector('#fechaEmision');
        return {
          existe: !!input,
          visible: input ? input.offsetParent !== null : false,
          disabled: input ? input.disabled : null,
          readonly: input ? input.readOnly : null,
          html: input ? input.outerHTML : null
        };
      });
      
      console.log(`[${cuit}] Estado de #fechaEmision:`, JSON.stringify(fechaEmisionExiste, null, 2));
      
      if (!fechaEmisionExiste.existe) {
        // Si no existe, buscar alternativas
        console.log(`[${cuit}] ⚠️  #fechaEmision NO EXISTE. Buscando alternativas...`);
        
        const alternativas = await page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"].form-control'));
          return inputs.map(i => ({
            id: i.id,
            name: i.name,
            class: i.className,
            placeholder: i.placeholder,
            html: i.outerHTML.substring(0, 200)
          }));
        });
        
        console.log(`[${cuit}] Inputs alternativos:`, JSON.stringify(alternativas, null, 2));
        
        throw new Error('El selector #fechaEmision no existe en la página. Ver logs de diagnóstico.');
      }
      
      if (!fechaEmisionExiste.visible) {
        console.log(`[${cuit}] ⚠️  #fechaEmision existe pero NO ES VISIBLE`);
      }
      
      // Intentar hacer click
      console.log(`[${cuit}] Haciendo click en #fechaEmision...`);
      
      try {
        await page.waitForSelector('#fechaEmision', { 
          visible: true, 
          timeout: 20000 
        });
        
        // Hacer scroll hasta el elemento
        await page.evaluate(() => {
          const element = document.querySelector('#fechaEmision');
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
        
        await sleep(1000);
        
        await page.click('#fechaEmision');
        console.log(`[${cuit}] ✓ Click en #fechaEmision ejecutado`);
        
      } catch (error) {
        console.error(`[${cuit}] ❌ Error haciendo click en #fechaEmision:`, error.message);
        
        // Intentar con JavaScript directo
        console.log(`[${cuit}] Intentando click con JavaScript...`);
        const clickResult = await page.evaluate(() => {
          const input = document.querySelector('#fechaEmision');
          if (input) {
            input.focus();
            input.click();
            return true;
          }
          return false;
        });
        
        if (!clickResult) {
          throw new Error('No se pudo hacer click en #fechaEmision ni con selector ni con JavaScript');
        }
        
        console.log(`[${cuit}] ✓ Click ejecutado con JavaScript`);
      }
      await sleep(1500);
      
      // Click en: <li data-range-key="Año Pasado" class="active">Año Pasado</li>
      console.log(`[${cuit}] Haciendo click en "Año Pasado"...`);
      await page.waitForSelector('li[data-range-key="Año Pasado"]', { visible: true, timeout: 5000 });
      await page.click('li[data-range-key="Año Pasado"]');
      await sleep(1000);

      // Click en "Buscar": <button type="submit" class="btn btn-primary col-xs-12" id="buscarComprobantes">Buscar</button>
      console.log(`[${cuit}] Click en Buscar...`);
      await page.click('#buscarComprobantes');
      
      // Esperar a que se actualice la tabla
      await sleep(3000);
      await page.waitForSelector('#tablaDataTables', { timeout: 30000 });

      // ============================================
      // CONFIGURAR VISTA DE 50 REGISTROS
      // ============================================
      console.log(`[${cuit}] Configurando vista de 50 registros...`);
      
      // Click en <i class="fa fa-lg fa-bars"></i>
      await page.click('.fa.fa-lg.fa-bars'); 
      await sleep(1000);

      // Click en <a href="#">50</a>
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const link50 = links.find(a => a.textContent.trim() === '50');
        if (link50) link50.click();
      });
      await sleep(3000); // Esperar que la tabla se redibuje

      // ============================================
      // ITERAR Y SUMAR
      // ============================================
      console.log(`[${cuit}] Comenzando suma de comprobantes...`);
      
      let totalFacturacion = 0.0;
      let hayPaginaSiguiente = true;
      let paginaActual = 1;

      while (hayPaginaSiguiente) {
        console.log(`[${cuit}] Procesando página ${paginaActual}...`);

        // Extraer datos de la página actual
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
              if (texto.includes('Factura') || texto.includes('Nota de Crédito') || texto.includes('Recibo')) {
                tipoComprobante = texto;
              }
              if (td.classList.contains('alignRight') && (texto.includes('$') || /[\d.,]+/.test(texto))) {
                importeTexto = texto;
              }
            });

            if (tipoComprobante && importeTexto) {
              const importeLimpio = importeTexto
                .replace('$', '')
                .replace(/\./g, '')
                .replace(',', '.')
                .trim();
              
              const importe = parseFloat(importeLimpio);

              if (!isNaN(importe)) {
                if (tipoComprobante.includes('Factura') || tipoComprobante.includes('Recibo')) {
                  suma += importe;
                } else if (tipoComprobante.includes('Nota de Crédito')) {
                  suma -= importe;
                }
                procesadas++;
              }
            }
          });

          return { sumaPagina: suma, filasProcesadas: procesadas };
        });

        totalFacturacion += sumaPagina;
        console.log(`[${cuit}] Página ${paginaActual}: procesadas ${filasProcesadas} filas. Subtotal acumulado: ${totalFacturacion.toLocaleString('es-AR')}`);

        // Verificar botón siguiente
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
          await sleep(2000);
        } else {
          hayPaginaSiguiente = false;
        }
      }

      montoFacturas = totalFacturacion.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      console.log(`[${cuit}] ✓ Cálculo finalizado. Total Facturación: ${montoFacturas}`);

    } catch (error) {
      console.error(`[${cuit}] ⚠ Error calculando facturación:`, error.message);
      
      // Tomar screenshot del error
      try {
        await page.screenshot({
          path: `/app/error_calculo_${cuit}_${Date.now()}.png`,
          fullPage: true
        });
      } catch (e) {
        // Ignorar errores al tomar screenshot
      }
      
      montoFacturas = 'Error al calcular';
    }

    const datosExtraidos = {
      cuit: cuit,
      nombre: nombreUsuario,
      facturasEmitidas: montoFacturas,
      timestamp: new Date().toISOString(),
      url_actual: page.url(),
      loginExitoso: true
    };

    return datosExtraidos;

  } catch (error) {
    console.error(`[${cuit}] Error extrayendo datos:`, error.message);
    throw new Error(`Error en extracción de datos: ${error.message}`);
  }
}

/**
 * Utilidad para esperar un tiempo (simular comportamiento humano)
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Función auxiliar para hacer scroll en la página
 */
async function scrollPage(page) {
  await page.evaluate(() => {
    window.scrollBy(0, window.innerHeight);
  });
  await sleep(500);
}

/**
 * Función auxiliar para esperar y hacer click en un elemento
 */
async function clickElementSafe(page, selector, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { timeout });
    await page.click(selector);
    return true;
  } catch (error) {
    console.error(`No se pudo hacer click en ${selector}:`, error.message);
    return false;
  }
}

/**
 * Función auxiliar para extraer texto de forma segura
 */
async function getTextSafe(page, selector) {
  try {
    return await page.$eval(selector, el => el.textContent.trim());
  } catch (error) {
    return null;
  }
}

module.exports = {
  procesarClienteAFIP,
  sleep,
  scrollPage,
  clickElementSafe,
  getTextSafe
};
