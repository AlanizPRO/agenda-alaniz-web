// Portal de reservas para clientes de Dianas Films.
// El cliente ve solo el color de cada día (libre, tentativo, confirmado) y sus propias reservas.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const DIAS_PARA_PAGO = 15;
const SERVICIOS = { FOTO: "Fotografía", VIDEO: "Video", EDICION: "Edición" };
const MONEDA = { USD: "US$", NIO: "C$" };
const ESTADOS = { pendiente: "Esperando aprobación", aprobada: "Aprobada", rechazada: "No aprobada", cancelada: "Cancelada" };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (s) => document.querySelector(s);

const estado = { email: "", dueno: "", nombre: "", mes: primerDia(new Date()), ocupados: {}, reservas: [], escuchas: [], fechaElegida: "", paraCaptura: null };

// ---------- Utilidades ----------
function primerDia(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function hoyISO() { return iso(new Date()); }
function desdeISO(s) { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); }
function sumarDias(s, n) { const d = desdeISO(s); d.setDate(d.getDate() + n); return iso(d); }
function fechaLarga(s) {
  const t = desdeISO(s).toLocaleDateString("es-NI", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function minutos(v) { if (!v) return null; const [h, m] = v.split(":").map(Number); return h * 60 + m; }
function hora12(min) {
  if (min == null) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}
function horario(r) { return r.horaInicio == null ? "Todo el día" : hora12(r.horaInicio) + (r.horaFin != null ? " a " + hora12(r.horaFin) : ""); }
function dinero(n, m) { return `${MONEDA[m] || ""} ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function servicios(r) { return (r.servicios || []).map((s) => SERVICIOS[s] || s).join(" + "); }

/** Enlace para agregar la reserva a Google Calendar del cliente. */
function enlaceGoogleCalendar(r) {
  const f = r.fecha.replaceAll("-", "");
  const hhmm = (min) => String(Math.floor(min / 60)).padStart(2, "0") + String(min % 60).padStart(2, "0") + "00";
  let fechas;
  if (r.horaInicio == null) fechas = `${f}/${sumarDias(r.fecha, 1).replaceAll("-", "")}`;
  else fechas = `${f}T${hhmm(r.horaInicio)}/${f}T${hhmm(r.horaFin ?? Math.min(r.horaInicio + 120, 23 * 60 + 59))}`;
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `Dianas Films: ${servicios(r)}`,
    dates: fechas,
    ctz: "America/Managua",
    location: r.lugar || "",
    details: `Reserva aprobada con Dianas Films.\nCliente o marca: ${r.marca}\nPrecio: ${dinero(r.precio, r.moneda)}\nFecha de pago: ${fechaLarga(sumarDias(r.fecha, DIAS_PARA_PAGO))}`,
  });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

// ---------- Sesión ----------
$("#btn-entrar").onclick = async () => {
  $("#error-entrar").textContent = "";
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { $("#error-entrar").textContent = "No se pudo entrar: " + e.message; }
};
// Entrar con un enlace que llega al correo (sin contraseña ni cuenta de Google)
$("#form-enlace").onsubmit = async (ev) => {
  ev.preventDefault();
  const correo = $("#correo-enlace").value.trim().toLowerCase();
  $("#error-entrar").textContent = "";
  $("#aviso-enlace").textContent = "";
  try {
    await sendSignInLinkToEmail(auth, correo, { url: location.origin + location.pathname, handleCodeInApp: true });
    try { localStorage.setItem("correo-enlace", correo); } catch {}
    $("#aviso-enlace").textContent = `Listo. Revisa ${correo} (también en spam) y toca el enlace para entrar.`;
  } catch (e) { $("#error-entrar").textContent = "No se pudo enviar el enlace: " + e.message; }
};
if (isSignInWithEmailLink(auth, location.href)) {
  let correo = "";
  try { correo = localStorage.getItem("correo-enlace") || ""; } catch {}
  if (!correo) correo = (prompt("Escribe tu correo para confirmar") || "").trim().toLowerCase();
  signInWithEmailLink(auth, correo, location.href)
    .then(() => { try { localStorage.removeItem("correo-enlace"); } catch {} history.replaceState(null, "", location.pathname); })
    .catch((e) => { $("#error-entrar").textContent = "El enlace no sirvió (puede que ya se usó o venció). Pide otro. " + e.message; });
}
$("#btn-salir").onclick = () => signOut(auth);
$("#btn-salir-2").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (u) => {
  estado.escuchas.forEach((f) => f());
  estado.escuchas = [];
  for (const id of ["#entrar", "#sin-acceso", "#app"]) $(id).classList.add("oculto");
  if (!u) { $("#entrar").classList.remove("oculto"); return; }
  estado.email = (u.email || "").toLowerCase();
  let registro = null;
  try { registro = await getDoc(doc(db, "clientesPortal", estado.email)); } catch (e) { console.error(e); }
  if (!registro?.exists()) {
    $("#correo-sin-acceso").textContent = estado.email;
    $("#sin-acceso").classList.remove("oculto");
    return;
  }
  estado.dueno = registro.data().owner;
  estado.nombre = registro.data().nombre || "";
  $("#saludo").textContent = estado.nombre ? `Hola, ${estado.nombre}` : estado.email;
  $("#app").classList.remove("oculto");
  estado.escuchas.push(
    onSnapshot(collection(db, "users", estado.dueno, "ocupados"), (snap) => {
      estado.ocupados = Object.fromEntries(snap.docs.map((d) => [d.id, d.data().estado]));
      pintar();
    }, (e) => console.error("Ocupados:", e)),
    onSnapshot(query(collection(db, "users", estado.dueno, "reservas"), where("clienteEmail", "==", estado.email)), (snap) => {
      estado.reservas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.fecha.localeCompare(a.fecha));
      pintar();
    }, (e) => console.error("Reservas:", e)),
  );
  pintar();
});

// ---------- Calendario ----------
$("#mes-ant").onclick = () => { estado.mes = new Date(estado.mes.getFullYear(), estado.mes.getMonth() - 1, 1); pintar(); };
$("#mes-sig").onclick = () => { estado.mes = new Date(estado.mes.getFullYear(), estado.mes.getMonth() + 1, 1); pintar(); };

function pintar() {
  pintarCalendario();
  pintarReservas();
}

function pintarCalendario() {
  const m = estado.mes;
  $("#mes-titulo").textContent = m.toLocaleDateString("es-NI", { month: "long", year: "numeric" });
  $("#mes-ant").disabled = m <= primerDia(new Date());
  const cal = $("#calendario");
  cal.innerHTML = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d) => `<div class="pc-dsem">${d}</div>`).join("");
  for (let i = 0; i < m.getDay(); i++) cal.insertAdjacentHTML("beforeend", '<button class="pc-dia vacio" tabindex="-1" aria-hidden="true"></button>');
  const dias = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const hoy = hoyISO();
  const mias = new Map(estado.reservas.filter((r) => r.estado === "pendiente" || r.estado === "aprobada").map((r) => [r.fecha, r]));
  for (let d = 1; d <= dias; d++) {
    const f = iso(new Date(m.getFullYear(), m.getMonth(), d));
    const b = document.createElement("button");
    b.className = "pc-dia";
    b.textContent = d;
    const ocupado = estado.ocupados[f];
    const mia = mias.get(f);
    if (f < hoy) b.classList.add("pasado");
    else if (ocupado) b.classList.add(ocupado === "confirmado" ? "confirmado" : "tentativo");
    if (mia) b.classList.add("mia");
    if (f === hoy) b.classList.add("hoy");
    b.setAttribute("aria-label", `${fechaLarga(f)}: ${f < hoy ? "pasado" : mia ? "tu reserva" : ocupado ? (ocupado === "confirmado" ? "confirmado" : "reserva tentativa") : "libre"}`);
    b.onclick = () => tocarDia(f, ocupado, mia);
    cal.appendChild(b);
  }
}

function tocarDia(f, ocupado, mia) {
  if (f < hoyISO()) return;
  if (mia) { aviso(`Ya tienes una reserva el ${fechaLarga(f)} (${ESTADOS[mia.estado].toLowerCase()}).`); return; }
  if (ocupado === "confirmado") { aviso("Esa fecha ya está confirmada con otro cliente. Elige otra."); return; }
  if (ocupado === "tentativo" && !confirm("Esa fecha tiene una reserva tentativa. ¿Quieres pedirla de todas formas? Dianas Films te confirmará si se puede.")) return;
  abrirReserva(f);
}

// ---------- Reservar ----------
const formRes = $("#form-reservar");
function abrirReserva(f) {
  estado.fechaElegida = f;
  formRes.reset();
  $("#res-error").textContent = "";
  $("#res-fecha-texto").textContent = fechaLarga(f);
  const anterior = estado.reservas.find((r) => r.marca);
  if (anterior) formRes.marca.value = anterior.marca;
  $("#dlg-reservar").showModal();
}
formRes.addEventListener("submit", async (e) => {
  if (e.submitter?.value === "cancel") return;
  e.preventDefault();
  const servicios = [...formRes.querySelectorAll('[name="servicios"]:checked')].map((c) => c.value);
  if (!servicios.length) { $("#res-error").textContent = "Elige al menos un servicio."; return; }
  const inicio = minutos(formRes.horaInicio.value), fin = minutos(formRes.horaFin.value);
  if (fin != null && fin <= inicio) { $("#res-error").textContent = "La hora de fin tiene que ser después de la de inicio."; return; }
  const boton = $("#btn-enviar-reserva");
  boton.disabled = true;
  try {
    const id = `${estado.fechaElegida}-${Date.now().toString(36)}`;
    await setDoc(doc(db, "users", estado.dueno, "reservas", id), {
      clienteEmail: estado.email,
      clienteNombre: estado.nombre,
      fecha: estado.fechaElegida,
      horaInicio: inicio,
      horaFin: fin,
      lugar: formRes.lugar.value.trim(),
      marca: formRes.marca.value.trim(),
      servicios,
      moneda: formRes.moneda.value,
      precio: Number(formRes.precio.value),
      notas: formRes.notas.value.trim(),
      estado: "pendiente",
      creada: Date.now(),
    });
    $("#dlg-reservar").close();
    aviso("¡Listo! Tu reserva quedó enviada. Dianas Films la va a revisar.");
  } catch (err) {
    $("#res-error").textContent = "No se pudo enviar: " + err.message;
  } finally {
    boton.disabled = false;
  }
});

// ---------- Mis pagos: cuánto debe y cuándo le toca pagar ----------
function porPagar(r) { return Math.max(0, Number(r.precio || 0) - Number(r.anticipo || 0)); }
function pintarPagos() {
  const pendientes = estado.reservas
    .filter((r) => r.estado === "aprobada" && !r.pagado && porPagar(r) > 0)
    .map((r) => ({ ...r, fechaPago: sumarDias(r.fecha, DIAS_PARA_PAGO) }))
    .sort((a, b) => a.fechaPago.localeCompare(b.fechaPago));
  $("#pagos").classList.toggle("oculto", !pendientes.length);
  if (!pendientes.length) return;
  const hoy = hoyISO();
  const total = {}, vencido = {};
  for (const r of pendientes) {
    total[r.moneda] = (total[r.moneda] || 0) + porPagar(r);
    if (r.fechaPago < hoy) vencido[r.moneda] = (vencido[r.moneda] || 0) + porPagar(r);
  }
  const cajas = Object.entries(total).map(([m, n]) => `<div><small>Total por pagar</small><b>${dinero(n, m)}</b></div>`);
  for (const [m, n] of Object.entries(vencido)) cajas.push(`<div class="vencido"><small>Ya vencido</small><b>${dinero(n, m)}</b></div>`);
  $("#pagos-total").innerHTML = cajas.join("");
  $("#pagos-lista").innerHTML = pendientes.map((r) => {
    const v = r.fechaPago < hoy;
    return `<div class="pc-pago${v ? " vencido" : ""}">
      <span><b>${fechaLarga(r.fechaPago)}</b>${v ? " (vencido)" : ""}
        <small>Trabajo del ${fechaLarga(r.fecha).toLowerCase()} · ${esc(r.marca)}${r.comprobante ? " · captura enviada" : ""}</small></span>
      <b>${dinero(porPagar(r), r.moneda)}</b></div>`;
  }).join("");
}

// ---------- Mis reservas ----------
function pintarReservas() {
  pintarPagos();
  const lista = $("#mis-reservas");
  if (!estado.reservas.length) {
    lista.innerHTML = '<p class="vacio">Todavía no tienes reservas. Toca un día libre en el calendario para pedir una.</p>';
    return;
  }
  lista.replaceChildren(...estado.reservas.map((r) => {
    const el = document.createElement("div");
    el.className = "pc-res";
    const fechaPago = sumarDias(r.fecha, DIAS_PARA_PAGO);
    const aprobada = r.estado === "aprobada";
    el.innerHTML = `
      <span class="pc-estado ${r.estado}">${ESTADOS[r.estado] || r.estado}</span>
      <div class="linea"><b>${fechaLarga(r.fecha)}</b><b>${dinero(r.precio, r.moneda)}</b></div>
      <div class="linea"><span>${horario(r)} · ${esc(servicios(r))}</span></div>
      <small class="suave">${esc(r.marca)}${r.lugar ? " · " + esc(r.lugar) : ""}</small>
      ${r.estado === "rechazada" && r.mensaje ? `<small>Mensaje: ${esc(r.mensaje)}</small>` : ""}
      ${aprobada ? (r.pagado
        ? '<small class="verde-t"><b>Pagado. ¡Gracias!</b></small>'
        : `<small>Fecha de pago: <b>${fechaLarga(fechaPago)}</b>${fechaPago < hoyISO() ? ' <span class="rojo">(vencida)</span>' : ""}</small>`) : ""}
      ${r.comprobante ? '<small class="verde-t">Captura de transferencia enviada.</small>' : ""}
      <div class="pc-acciones"></div>`;
    const acciones = el.querySelector(".pc-acciones");
    if (aprobada) {
      const cal = document.createElement("a");
      cal.className = "btn borde";
      cal.href = enlaceGoogleCalendar(r);
      cal.target = "_blank";
      cal.rel = "noopener";
      cal.textContent = "Agregar a mi Google Calendar";
      acciones.appendChild(cal);
      if (!r.pagado) {
        const b = document.createElement("button");
        b.className = "btn primario";
        b.textContent = r.comprobante ? "Cambiar captura" : "Enviar captura de transferencia";
        b.onclick = () => abrirCaptura(r);
        acciones.appendChild(b);
      }
    }
    return el;
  }));
}

// ---------- Captura de transferencia ----------
function abrirCaptura(r) {
  estado.paraCaptura = r;
  $("#form-captura").reset();
  $("#captura-vista").classList.add("oculto");
  $("#captura-error").textContent = "";
  $("#captura-detalle").textContent = `Reserva del ${fechaLarga(r.fecha)} · ${dinero(r.precio, r.moneda)}`;
  $("#dlg-captura").showModal();
}
let capturaLista = null;
$("#captura-archivo").addEventListener("change", async (e) => {
  capturaLista = null;
  const archivo = e.target.files[0];
  if (!archivo) return;
  try {
    capturaLista = await reducirImagen(archivo);
    $("#captura-vista").src = capturaLista;
    $("#captura-vista").classList.remove("oculto");
  } catch {
    $("#captura-error").textContent = "No se pudo leer la imagen. Prueba con otra.";
  }
});
$("#form-captura").addEventListener("submit", async (e) => {
  if (e.submitter?.value === "cancel") return;
  e.preventDefault();
  if (!capturaLista) { $("#captura-error").textContent = "Elige la imagen de la transferencia."; return; }
  const boton = $("#btn-enviar-captura");
  boton.disabled = true;
  try {
    await updateDoc(doc(db, "users", estado.dueno, "reservas", estado.paraCaptura.id), { comprobante: capturaLista, comprobanteFecha: Date.now() });
    $("#dlg-captura").close();
    aviso("Captura enviada. ¡Gracias!");
  } catch (err) {
    $("#captura-error").textContent = "No se pudo enviar: " + err.message;
  } finally {
    boton.disabled = false;
  }
});

/** Achica la foto para que pese poco (máximo 1400 px y unos 700 KB). */
async function reducirImagen(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
    let lado = 1400, calidad = 0.82, datos;
    do {
      const k = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      datos = c.toDataURL("image/jpeg", calidad);
      lado = Math.round(lado * 0.8);
      calidad = Math.max(0.5, calidad - 0.08);
    } while (datos.length > 700_000 && lado > 400);
    return datos;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function aviso(texto) {
  const a = document.createElement("div");
  a.textContent = texto;
  a.setAttribute("role", "status");
  a.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1F2937;color:#fff;padding:12px 18px;border-radius:12px;z-index:9999;font-size:14px;max-width:90vw;text-align:center";
  document.body.appendChild(a);
  setTimeout(() => a.remove(), 4000);
}
