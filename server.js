const express = require("express");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");
const puppeteer = require("puppeteer");
const path = require("path");
const { Resend } = require('resend');
require("dotenv").config();

const app = express();

// ================================
// CONFIGURACIÓN DE RESEND
// ================================
let resend = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log('✅ Resend configurado');
} else {
  console.warn('⚠️  RESEND_API_KEY no configurado - Los emails no se enviarán');
}

// Función para enviar email con Resend
async function enviarEmail(destinatario, excelPath, filename) {
  if (!resend) {
    console.log('⚠️  Email no enviado - RESEND_API_KEY no configurado');
    return false;
  }

  try {
    // Leer archivo Excel como base64
    const attachment = fs.readFileSync(excelPath).toString('base64');
    
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'AFIP Automation <onboarding@resend.dev>',
      to: [destinatario],
      subject: '✅ Resultados AFIP - Proceso Completado',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4F46E5;">🎉 Proceso Completado</h2>
          <p>Tu extracción de datos de AFIP ha finalizado exitosamente.</p>
          <p>En el archivo adjunto encontrarás:</p>
          <ul>
            <li>📊 <strong>Comprobantes Emitidos</strong> por cliente</li>
            <li>📥 <strong>Comprobantes Recibidos</strong> por cliente</li>
          </ul>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;">
          <p style="color: #6B7280; font-size: 14px;">
            Este es un email automático del sistema de automatización AFIP.
          </p>
        </div>
      `,
      attachments: [
        {
          filename: filename,
          content: attachment
        }
      ]
    });
    
    if (error) {
      console.error("❌ Error enviando email:", error);
      return false;
    }
    
    console.log("📧 Email enviado via Resend:", data.id);
    return true;
  } catch (error) {
    console.error("❌ Error enviando email:", error);
    return false;
  }
}

// ================================
// CORS
// ================================
app.use(cors());
app.use(express.json());

// ================================
// MULTER (SUBIDA DE ARCHIVOS)
// ================================
const upload = multer({ dest: "/tmp" });

// ================================
// HEALTH CHECK
// ================================
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ================================
// SSE (EVENT STREAM)
// ================================
function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ================================
// FUNCIÓN HELPER: SLEEP
// ================================
const { procesarClienteAFIP, sleep } = require('./scraper');

// ================================
// FUNCIÓN: PROCESAR UN CLIENTE EN AFIP (WRAPPER)
// ================================


// ================================
// RUTA PRINCIPAL: /api/process
// ================================
app.post("/api/process", upload.single("excel"), async (req, res) => {
  console.log("📥 Archivo recibido.");

  if (!req.file) {
    console.log("❌ No se recibió archivo.");
    return res.status(400).json({ error: "No se recibió archivo" });
  }

  const userEmail = req.body.email;
  console.log(`📁 Archivo: ${req.file.originalname} (${req.file.size} bytes)`);
  console.log(`📧 Email destinatario: ${userEmail}`);

  // Configurar SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let browser = null;
  let excelPath = null;

  try {
    // Leer Excel de entrada
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Saltar primera fila si son headers
    const dataRows = rows.slice(1).filter(row => row.length >= 3);

    console.log(`📊 ${dataRows.length} clientes encontrados`);

    if (dataRows.length === 0) {
      throw new Error('No se encontraron datos válidos en el Excel');
    }

    const total = dataRows.length;
    const resultados = [];

    // Procesar cada cliente CON NAVEGADOR INDEPENDIENTE
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];

      const CUIT = String(row[0] || '').trim().replace(/\D/g, '');
      const CLAVE = String(row[1] || '').trim();
      const NUM_CLIENTE = String(row[2] || '').trim();

      if (!CUIT || !CLAVE || !NUM_CLIENTE) {
        console.log(`⚠️  [${i + 1}/${total}] Fila incompleta, saltando...`);
        continue;
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔎 [${i + 1}/${total}] Cliente: ${NUM_CLIENTE} - CUIT: ${CUIT}`);
      console.log(`${'='.repeat(60)}`);

      // Enviar progreso al frontend
      sendSSE(res, {
        type: "progress",
        current: i + 1,
        total,
        cuit: CUIT,
        numCliente: NUM_CLIENTE
      });

      // ABRIR NAVEGADOR NUEVO PARA ESTE CLIENTE
      // Procesar cliente usando el módulo externo (que maneja su propio browser)
      try {
        const resultado = await procesarClienteAFIP(CUIT, CLAVE);

        // Adaptar respuesta del nuevo scraper al formato esperado aquí
        resultados.push({
          numCliente: NUM_CLIENTE,
          nombre: resultado.nombre,
          facturasEmitidas: resultado.facturasEmitidas,
          comprobantesRecibidos: resultado.comprobantesRecibidos
        });
        console.log(`✅ [${i + 1}/${total}] Procesado exitosamente`);

      } catch (error) {
        console.error(`❌ [${i + 1}/${total}] Error al procesar:`, error.message);

        resultados.push({
          numCliente: NUM_CLIENTE,
          nombre: `ERROR: ${error.message}`,
          facturasEmitidas: 'N/A',
          comprobantesRecibidos: 'N/A'
        });
      }

      // Espera entre clientes para simular comportamiento humano
      if (i < dataRows.length - 1) {
        const espera = 2000 + Math.random() * 3000;
        console.log(`⏳ Esperando ${(espera / 1000).toFixed(1)}s antes del siguiente cliente...`);
        await sleep(espera);
      }


    }

    console.log(`\n✨ Proceso completado. Generando Excel...`);

    // ================================
    // CREAR EXCEL DE SALIDA
    // ================================
    const datosExcel = [
      ['Num de Cliente', 'Nombre del Cliente', 'Comprobantes Emitidos', 'Comprobantes Recibidos'],
      ...resultados.map(r => [
        r.numCliente, 
        r.nombre, 
        r.facturasEmitidas || 'N/A',
        r.comprobantesRecibidos || 'N/A'
      ])
    ];

    const nuevoWorkbook = XLSX.utils.book_new();
    const nuevaHoja = XLSX.utils.aoa_to_sheet(datosExcel);
    XLSX.utils.book_append_sheet(nuevoWorkbook, nuevaHoja, 'Resultados');

    // Guardar Excel en /tmp
    excelPath = path.join('/tmp', `resultados_${Date.now()}.xlsx`);
    XLSX.writeFile(nuevoWorkbook, excelPath);

    console.log(`📊 Excel generado: ${excelPath}`);

    // Leer archivo como base64
    const excelBuffer = fs.readFileSync(excelPath);
    const excelBase64 = excelBuffer.toString('base64');

    // Enviar resultado final con el Excel
    sendSSE(res, {
      type: "complete",
      results: resultados,
      excel: excelBase64,
      filename: `resultados_afip_${new Date().toISOString().split('T')[0]}.xlsx`
    });

    // Enviar email si se proporcionó
    if (userEmail) {
      console.log(`📧 Enviando email a ${userEmail}...`);
      const emailEnviado = await enviarEmail(
        userEmail,
        excelPath,
        `resultados_afip_${new Date().toISOString().split('T')[0]}.xlsx`
      );
      
      if (emailEnviado) {
        sendSSE(res, {
          type: "email_sent",
          email: userEmail
        });
      }
    }

    res.end();

    // Limpiar archivos
    fs.unlinkSync(req.file.path);
    fs.unlinkSync(excelPath);

    console.log(`✅ Archivos temporales eliminados`);

  } catch (error) {
    console.error("❌ Error general:", error);

    sendSSE(res, {
      type: "error",
      message: error.message,
    });

    res.end();

    // Limpiar recursos
    if (browser) {
      await browser.close();
    }
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    if (excelPath && fs.existsSync(excelPath)) {
      fs.unlinkSync(excelPath);
    }
  }
});

// ================================
// INICIO DEL SERVIDOR
// ================================
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("╔════════════════════════════════════════════╗");
  console.log("║   🚀 SERVIDOR INICIADO                    ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log(`📍 Puerto: ${PORT}`);
  console.log(`🌍 URL: http://localhost:${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log(`📊 API: http://localhost:${PORT}/api/process`);
  console.log(`✅ Listo para recibir requests`);
});
