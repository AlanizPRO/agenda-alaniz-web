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

const ANCHO = 1080;
const MARGEN = 80;
const TINTA = "#1F2937", GRIS = "#6B7280", LINEA = "#E5E7EB", FONDO = "#F3F6FA";
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

/** Dibuja la proforma en un canvas. datos: { numero, fecha, cliente, servicio, fechaTrabajo, precio, anticipo, nota } */
export async function dibujarProforma(datos, formatoDinero, formatoFecha) {
  const lienzo = document.createElement("canvas");
  lienzo.width = ANCHO;
  lienzo.height = 2400;
  const c = lienzo.getContext("2d");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, ANCHO, lienzo.height);
  c.textBaseline = "top";
  const der = ANCHO - MARGEN, centro = ANCHO / 2;

  const texto = (s, x, y, tam, color, alinear = "left", peso = 400, familia = SANS) => {
    c.font = `${peso} ${tam}px ${familia}`;
    c.fillStyle = color;
    c.textAlign = alinear;
    c.fillText(s, x, y);
    return tam * 1.17;
  };
  const linea = (y) => { c.fillStyle = LINEA; c.fillRect(MARGEN, y - 1.5, ANCHO - 2 * MARGEN, 3); return y; };
  const fila = (etiqueta, valor, y, color, negrita = false) => {
    texto(etiqueta, MARGEN, y, 34, negrita ? TINTA : GRIS, "left", negrita ? 700 : 400);
    texto(valor, der, y, 34, color, "right", 700);
  };

  let y = 70;
  const img = await cargarLogo();
  if (img) { c.drawImage(img, centro - 110, y, 220, 220); y += 250; }
  y += texto(EMPRESA.toUpperCase(), centro, y, 64, TINTA, "center", 700, SERIF);
  y += texto(LEMA, centro, y + 6, 30, GRIS, "center") + 6;
  y += texto(TELEFONO, centro, y + 4, 32, GRIS, "center") + 4;
  y += texto(RUC, centro, y + 4, 32, GRIS, "center") + 4;
  y += 36;
  linea(y);

  y += 50;
  y += texto("Proforma", centro, y, 46, TINTA, "center", 700) + 40;
  const filas = [
    ["Número", datos.numero],
    ["Fecha", formatoFecha(datos.fecha)],
    ["Válida hasta", formatoFecha(sumarDias(datos.fecha, VIGENCIA_DIAS))],
    ["Cliente", datos.cliente],
    ["Fecha del trabajo", datos.fechaTrabajo ? formatoFecha(datos.fechaTrabajo) : "Por definir"],
  ];
  for (const [e, v] of filas) { fila(e, v, y, TINTA); y += 62; }
  y += 10;
  linea(y);

  y += 56;
  const precio = formatoDinero(datos.precio);
  texto(datos.servicio, MARGEN, y, 40, TINTA, "left", 700);
  texto(precio, der, y, 40, TINTA, "right", 700);
  y += 80;
  linea(y);

  y += 56;
  fila("Total", precio, y, TINTA, true); y += 62;
  if (datos.anticipo > 0) {
    fila("Anticipo para reservar", "-" + formatoDinero(datos.anticipo), y, TINTA); y += 62;
    fila("Saldo", formatoDinero(datos.precio - datos.anticipo), y, TINTA, true); y += 62;
  }
  if (datos.nota) { y += 20; y += texto(datos.nota, MARGEN, y, 30, GRIS) + 20; }
  y += 40;

  const alto = 100 + CUENTAS.length * 56;
  c.fillStyle = FONDO;
  c.beginPath(); c.roundRect(MARGEN, y, der - MARGEN, alto, 28); c.fill();
  texto("Datos para transferencia", MARGEN + 40, y + 34, 32, TINTA, "left", 700);
  let yc = y + 92;
  for (const [e, v] of CUENTAS) { texto(e, MARGEN + 40, yc, 30, GRIS); texto(v, der - 40, yc, 30, TINTA, "right", 700); yc += 56; }
  y += alto + 50;
  y += texto(`Esta proforma es válida por ${VIGENCIA_DIAS} días.`, centro, y, 30, GRIS, "center");
  y += 70;

  const final = document.createElement("canvas");
  final.width = ANCHO;
  final.height = Math.round(y);
  final.getContext("2d").drawImage(lienzo, 0, 0);
  return final;
}

/** Envuelve un JPG en un PDF de una página (letter, en proporción de la imagen). Sin librerías. */
export function jpgAPdf(jpgBytes, anchoPx, altoPx) {
  const enc = new TextEncoder();
  const ancho = 612, alto = Math.round(612 * altoPx / anchoPx);
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
