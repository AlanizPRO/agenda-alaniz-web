// Recibo de pago o aviso de cobro en JPG para mandarle al cliente. Mismo diseño que en la app.

const EMPRESA = "Dianas Films";
const LEMA = "Productora audiovisual";
const TELEFONO = "Cel: +505 8803-9928";
const CUENTA = [["Banco", "LAFISE"], ["Cuenta en dólares", "109277829"], ["A nombre de", "Juan Carlos Perez Alaniz"]];

const ANCHO = 1080;
const MARGEN = 80;
const TINTA = "#1F2937", GRIS = "#6B7280", LINEA = "#E5E7EB";
const VERDE = "#2E9E6B", ROJO = "#D9534F", AZUL = "#1565C0", FONDO = "#F3F6FA";
const SANS = "Inter, Roboto, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

const TITULOS = { PAGO: "Recibo de pago", COBRO: "Aviso de cobro", VENCIDO: "Cobro vencido" };

function fechaTexto(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-NI", { day: "numeric", month: "long", year: "numeric" });
}

export function numeroRecibo(t) {
  return `DF-${t.fecha.slice(0, 4)}-${(t.uuid || "").slice(0, 6).toUpperCase()}`;
}

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

/** Dibuja el recibo; `u` trae las reglas de la app (saldo, fechaCobro, hoy, dinero, tiposTexto, modalidad). */
export async function dibujarRecibo(t, u) {
  const tipo = t.pagado ? "PAGO" : u.fechaCobro(t) < u.hoy() ? "VENCIDO" : "COBRO";
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
  const medir = (s, tam, peso = 400) => { c.font = `${peso} ${tam}px ${SANS}`; return c.measureText(s).width; };
  const ajustar = (s, tam, peso, ancho) => {
    if (medir(s, tam, peso) <= ancho) return s;
    while (s.length > 1 && medir(s + "…", tam, peso) > ancho) s = s.slice(0, -1);
    return s + "…";
  };
  const linea = (y) => { c.fillStyle = LINEA; c.fillRect(MARGEN, y - 1.5, ANCHO - 2 * MARGEN, 3); return y; };
  const fila = (etiqueta, valor, y, color, etiquetaNegrita = false) => {
    const ancho = medir(etiqueta, 34, etiquetaNegrita ? 700 : 400);
    texto(etiqueta, MARGEN, y, 34, etiquetaNegrita ? TINTA : GRIS, "left", etiquetaNegrita ? 700 : 400);
    texto(ajustar(valor, 34, 700, der - MARGEN - ancho - 40), der, y, 34, color, "right", 700);
  };

  let y = 70;
  const img = await cargarLogo();
  if (img) { c.drawImage(img, centro - 110, y, 220, 220); y += 250; }
  y += texto(EMPRESA.toUpperCase(), centro, y, 64, TINTA, "center", 700, SERIF);
  y += texto(LEMA, centro, y + 6, 30, GRIS, "center") + 6;
  y += texto(TELEFONO, centro, y + 4, 32, GRIS, "center") + 4;
  y += 36;
  linea(y);

  const colorTipo = { PAGO: VERDE, COBRO: AZUL, VENCIDO: ROJO }[tipo];
  y += 50;
  y += texto(TITULOS[tipo], centro, y, 46, colorTipo, "center", 700) + 40;
  const filas = [
    ["Número", numeroRecibo(t)],
    ["Fecha", fechaTexto(u.hoy())],
    ["Cliente", t.cliente],
    ["Fecha del trabajo", fechaTexto(t.fecha)],
  ];
  if (tipo !== "PAGO") filas.push([tipo === "VENCIDO" ? "Venció el" : "Fecha de pago", fechaTexto(u.fechaCobro(t))]);
  filas.push(["Estado", { PAGO: "Pagado", COBRO: "Pendiente", VENCIDO: "Vencido" }[tipo]]);
  for (const [e, v] of filas) { fila(e, v, y, e === "Estado" ? colorTipo : TINTA); y += 62; }
  y += 10;
  linea(y);

  y += 56;
  const precio = u.dinero(t.precio, t.moneda);
  texto(ajustar(t.titulo || u.modalidad(t), 40, 700, der - MARGEN - medir(precio, 40, 700) - 40), MARGEN, y, 40, TINTA, "left", 700);
  texto(precio, der, y, 40, TINTA, "right", 700);
  y += 56;
  const detalle = [u.tiposTexto(t), t.titulo ? u.modalidad(t) : ""].filter(Boolean).join(" · ");
  if (detalle) { texto(ajustar(detalle, 32, 400, der - MARGEN), MARGEN, y, 32, GRIS); y += 50; }
  y += 10;
  linea(y);

  y += 56;
  fila("Total", precio, y, TINTA, true); y += 62;
  if (t.anticipo > 0 && !t.pagado) { fila("Anticipo recibido", "-" + u.dinero(t.anticipo, t.moneda), y, TINTA); y += 62; }
  if (t.pagado) { fila("Pagado", precio, y, VERDE); y += 62; }
  y += 30;
  const saldo = u.saldo(t);
  texto("Saldo", MARGEN, y + 20, 50, TINTA, "left", 700);
  texto(u.dinero(saldo, t.moneda), der, y + 10, 66, saldo > 0 && tipo === "VENCIDO" ? ROJO : TINTA, "right", 700);
  y += 130;
  if (tipo !== "PAGO") {
    const alto = 100 + CUENTA.length * 56;
    c.fillStyle = FONDO;
    c.beginPath(); c.roundRect(MARGEN, y, der - MARGEN, alto, 28); c.fill();
    texto("Datos para transferencia", MARGEN + 40, y + 34, 32, TINTA, "left", 700);
    let yc = y + 92;
    for (const [e, v] of CUENTA) { texto(e, MARGEN + 40, yc, 30, GRIS); texto(v, der - 40, yc, 30, TINTA, "right", 700); yc += 56; }
    y += alto + 50;
  }
  y += texto(tipo === "PAGO" ? "Gracias por su preferencia" : "Gracias por su pago puntual", centro, y, 30, GRIS, "center");
  y += 70;

  const final = document.createElement("canvas");
  final.width = ANCHO;
  final.height = Math.round(y);
  final.getContext("2d").drawImage(lienzo, 0, 0);
  return { lienzo: final, tipo };
}

/** Comparte el JPG (celular) o lo descarga (computadora). */
export async function enviarRecibo(t, u) {
  const { lienzo, tipo } = await dibujarRecibo(t, u);
  const blob = await new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", 0.92));
  const nombre = `recibo_${t.cliente.replace(/[^A-Za-z0-9]+/g, "_")}_${numeroRecibo(t)}.jpg`;
  const archivo = new File([blob], nombre, { type: "image/jpeg" });
  if (navigator.canShare?.({ files: [archivo] }) && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ files: [archivo], title: TITULOS[tipo] }); } catch { /* lo canceló */ }
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
