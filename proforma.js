// Proforma en PDF para mandar al cliente por WhatsApp o Gmail.
// Se arma con 4 preguntas (cliente, servicio, fecha, precio) y se comparte como PDF.

const EMPRESA = "Dianas Films";
const LEMA = "Productora audiovisual";
const TELEFONO = "Cel: +505 8803-9928";
const RUC = "RUC: 001-130682-0036D";
const CUENTAS = [
  ["Cuenta BAC dólares", "373753060"],
  ["Cuenta BAC córdobas", "374906725"],
  ["A nombre de", "Heydi Diana Bojorge Baltodano"],
];
const VIGENCIA_DIAS = 5;

const ANCHO = 1275; // carta a 150 ppp
const ALTO = 1650;
const MARGEN = 110;
const TINTA = "#1F2937", GRIS = "#6B7280", LINEA = "#E5E7EB", FONDO = "#F3F6FA", AZUL = "#1565C0";
const SANS = "Inter, Roboto, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

let logo = null;
function cargarLogo() {
  logo ??= new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = "logo-diana.png";
  });
  return logo;
}

/** Suma días a una fecha ISO (AAAA-MM-DD) y devuelve otra en el mismo formato. */
export function sumarDias(iso, dias) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** "15:30" -> "3:30 p. m." */
export function hora12(h) {
  if (!h) return "";
  const [hh, mm] = h.split(":").map(Number);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "a. m." : "p. m."}`;
}
export function horarioTexto(inicio, fin) {
  if (!inicio) return "";
  return fin ? `${hora12(inicio)} a ${hora12(fin)}` : `Desde ${hora12(inicio)}`;
}

/** Dibuja la proforma en un canvas. datos: { numero, fecha, cliente, servicio, fechaTrabajo, precio, anticipo, nota } */
export async function dibujarProforma(datos, formatoDinero, formatoFecha) {
  // Hoja tamaño carta (8.5 x 11 pulgadas) a 150 puntos por pulgada.
  const lienzo = document.createElement("canvas");
  lienzo.width = ANCHO;
  lienzo.height = ALTO;
  const c = lienzo.getContext("2d");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, ANCHO, ALTO);
  c.textBaseline = "top";
  const der = ANCHO - MARGEN;

  const texto = (s, x, y, tam, color, alinear = "left", peso = 400, familia = SANS) => {
    c.font = `${peso} ${tam}px ${familia}`;
    c.fillStyle = color;
    c.textAlign = alinear;
    c.fillText(s, x, y);
  };
  const medir = (s, tam, peso = 400) => { c.font = `${peso} ${tam}px ${SANS}`; return c.measureText(s).width; };
  const ajustar = (s, tam, peso, ancho) => {
    if (medir(s, tam, peso) <= ancho) return s;
    while (s.length > 1 && medir(s + "…", tam, peso) > ancho) s = s.slice(0, -1);
    return s + "…";
  };
  // Parte un texto en renglones que caben en el ancho (respeta los saltos de línea que escribió la persona)
  const renglones = (s, tam, peso, ancho) => {
    const salida = [];
    for (const parrafo of String(s).split(/\n/)) {
      let actual = "";
      for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
        const prueba = actual ? actual + " " + palabra : palabra;
        if (medir(prueba, tam, peso) <= ancho || !actual) actual = prueba;
        else { salida.push(actual); actual = palabra; }
      }
      salida.push(actual);
    }
    return salida.map((r) => ajustar(r, tam, peso, ancho));
  };
  const parrafo = (s, x, y, tam, color, ancho, peso = 400, interlineado = 1.4, maxLineas = Infinity) => {
    let lineas = renglones(s, tam, peso, ancho);
    if (lineas.length > maxLineas) {
      lineas = lineas.slice(0, Math.max(1, maxLineas));
      lineas[lineas.length - 1] = ajustar(lineas[lineas.length - 1] + " …", tam, peso, ancho);
    }
    lineas.forEach((r, i) => texto(r, x, y + i * tam * interlineado, tam, color, "left", peso));
    return lineas.length * tam * interlineado;
  };
  const linea = (y, x1 = MARGEN, x2 = der, grosor = 2, color = LINEA) => { c.fillStyle = color; c.fillRect(x1, y, x2 - x1, grosor); };
  const caja = (x, y, w, h, r = 18) => { c.fillStyle = FONDO; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };

  // Encabezado: logo y datos de la empresa a la izquierda, título y número a la derecha
  let y = 90;
  const img = await cargarLogo();
  const tamLogo = 170;
  if (img) c.drawImage(img, MARGEN, y, tamLogo, tamLogo);
  const xEmp = MARGEN + (img ? tamLogo + 32 : 0);
  texto(EMPRESA.toUpperCase(), xEmp, y + 8, 44, TINTA, "left", 700, SERIF);
  texto(LEMA, xEmp, y + 66, 24, GRIS);
  texto(TELEFONO, xEmp, y + 100, 24, GRIS);
  texto(RUC, xEmp, y + 134, 24, GRIS);

  texto("PROFORMA", der, y + 4, 52, AZUL, "right", 700);
  const info = [["No.", datos.numero], ["Fecha", formatoFecha(datos.fecha)], ["Válida hasta", formatoFecha(sumarDias(datos.fecha, VIGENCIA_DIAS))]];
  let yi = y + 76;
  for (const [e, v] of info) {
    const wv = medir(v, 24, 700);
    texto(v, der, yi, 24, TINTA, "right", 700);
    texto(e, der - wv - 14, yi, 24, GRIS, "right");
    yi += 34;
  }
  y += tamLogo + 50;
  linea(y, MARGEN, der, 4, AZUL);

  // Cliente
  y += 40;
  texto("CLIENTE", MARGEN, y, 22, GRIS, "left", 700);
  y += 34;
  y += parrafo(datos.cliente, MARGEN, y, 34, TINTA, der - MARGEN, 700, 1.25);
  y += 28;

  // Tabla de servicios
  const colFecha = MARGEN + 640, colImporte = der;
  caja(MARGEN, y, der - MARGEN, 58, 12);
  texto("Descripción", MARGEN + 24, y + 17, 24, TINTA, "left", 700);
  texto("Fecha del trabajo", colFecha, y + 17, 24, TINTA, "left", 700);
  texto("Importe", colImporte - 24, y + 17, 24, TINTA, "right", 700);
  y += 58 + 26;
  const precio = formatoDinero(datos.precio);
  const altoServicio = parrafo(datos.servicio, MARGEN + 24, y, 28, TINTA, colFecha - MARGEN - 60);
  texto(datos.fechaTrabajo ? formatoFecha(datos.fechaTrabajo) : "Por definir", colFecha, y, 28, TINTA);
  const horario = horarioTexto(datos.horaInicio, datos.horaFin);
  if (horario) texto(horario, colFecha, y + 38, 22, GRIS);
  texto(precio, colImporte - 24, y, 28, TINTA, "right", 700);
  y += Math.max(horario ? 90 : 60, altoServicio + 20);
  linea(y);

  // Totales a la derecha
  y += 34;
  const xEt = der - 560;
  const total = (e, v, negrita = false, tam = 28) => {
    texto(e, xEt, y, tam, negrita ? TINTA : GRIS, "left", negrita ? 700 : 400);
    texto(v, colImporte - 24, y, tam, TINTA, "right", 700);
    y += tam + 22;
  };
  total("Total", precio, true, 32);
  if (datos.anticipo > 0) {
    total("Anticipo para reservar", "-" + formatoDinero(datos.anticipo));
    total("Saldo", formatoDinero(datos.precio - datos.anticipo), true);
  }

  // Nota para el cliente (sin pisar el cuadro de transferencia de abajo)
  const altoCaja = 70 + CUENTAS.length * 44;
  const topeNota = ALTO - 120 - altoCaja - 40;
  if (datos.nota) {
    y += 20;
    texto("NOTA", MARGEN, y, 22, GRIS, "left", 700);
    y += 34;
    const caben = Math.floor((topeNota - y) / (26 * 1.4));
    y += parrafo(datos.nota, MARGEN, y, 26, TINTA, der - MARGEN, 400, 1.4, caben) + 20;
  }

  // Datos para transferencia, abajo
  let yb = ALTO - 120 - altoCaja;
  caja(MARGEN, yb, der - MARGEN, altoCaja);
  texto("Datos para transferencia", MARGEN + 32, yb + 26, 26, TINTA, "left", 700);
  let yc = yb + 72;
  for (const [e, v] of CUENTAS) { texto(e, MARGEN + 32, yc, 24, GRIS); texto(v, der - 32, yc, 24, TINTA, "right", 700); yc += 44; }

  // Pie
  linea(ALTO - 90);
  texto(`Esta proforma es válida por ${VIGENCIA_DIAS} días a partir de su fecha. Gracias por su preferencia.`, ANCHO / 2, ALTO - 70, 22, GRIS, "center");
  return lienzo;
}

/** Envuelve un JPG en un PDF de una página tamaño carta (612 x 792 puntos). Sin librerías. */
export function jpgAPdf(jpgBytes, anchoPx, altoPx) {
  const enc = new TextEncoder();
  const ancho = 612, alto = 792;
  const partes = [];
  const offs = [];
  let tam = 0;
  const push = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; partes.push(b); tam += b.length; };
  const obj = (n, cuerpo) => { offs[n] = tam; push(`${n} 0 obj\n${cuerpo}\nendobj\n`); };
  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ancho} ${alto}] /Resources << /XObject << /Im 4 0 R >> >> /Contents 5 0 R >>`);
  offs[4] = tam;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${anchoPx} /Height ${altoPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpgBytes.length} >>\nstream\n`);
  push(jpgBytes);
  push("\nendstream\nendobj\n");
  const contenido = `q ${ancho} 0 0 ${alto} 0 0 cm /Im Do Q`;
  obj(5, `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`);
  const inicioXref = tam;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let n = 1; n <= 5; n++) xref += String(offs[n]).padStart(10, "0") + " 00000 n \n";
  push(xref + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);
  return new Blob(partes, { type: "application/pdf" });
}

/** Crea el PDF de la proforma y lo comparte (celular) o lo descarga (computadora). */
export async function enviarProforma(datos, formatoDinero, formatoFecha) {
  const canvas = await dibujarProforma(datos, formatoDinero, formatoFecha);
  const jpg = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.92));
  const pdf = jpgAPdf(new Uint8Array(await jpg.arrayBuffer()), canvas.width, canvas.height);
  const nombre = `proforma_${datos.cliente.replace(/[^A-Za-z0-9]+/g, "_")}_${datos.numero}.pdf`;
  const archivo = new File([pdf], nombre, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo], title: `Proforma ${datos.numero}` }); } catch { /* lo canceló */ }
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(pdf);
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
