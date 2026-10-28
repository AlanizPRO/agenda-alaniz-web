import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, query, setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js";
import { enviarRecibo } from "./recibo.js";

const DIAS_PARA_COBRO = 15;
const TIPOS = { FOTO: "Fotos", VIDEO: "Video", EDICION: "Edición" };
const MODALIDAD = { EVENTO: "Cobertura de evento", REEL: "Reel para redes", OTRO: "Otro" };
const MONEDA = { USD: { simbolo: "US$", nombre: "Dólares" }, NIO: { simbolo: "C$", nombre: "Córdobas" } };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (sel) => document.querySelector(sel);
const estado = {
  trabajos: [],
  sesion: null,
  mes: primerDiaMes(new Date()),
  seleccion: hoyISO(),
  pestana: "agenda",
  dejarDeEscuchar: null,
  gastos: [],
  dejarDeEscucharGastos: null,
  depositos: [],
  dejarDeEscucharDepositos: null,
  mesGastos: primerDiaMes(new Date()),
  filtroGasto: null,
};

// ---------- Utilidades ----------

function hoyISO() {
  const d = new Date();
  return iso(d);
}
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function desdeISO(s) {
  const [a, m, d] = s.split("-").map(Number);
  return new Date(a, m - 1, d);
}
function primerDiaMes(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function sumarDias(s, n) {
  const d = desdeISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
const fmtNum = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function dinero(monto, moneda) {
  return `${MONEDA[moneda]?.simbolo ?? ""} ${fmtNum.format(monto || 0)}`;
}
function fechaCorta(s) {
  const t = desdeISO(s).toLocaleDateString("es-NI", { weekday: "short", day: "numeric", month: "short" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function fechaLarga(s) {
  const t = desdeISO(s).toLocaleDateString("es-NI", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function minutosATexto(m) {
  if (m == null) return "";
  const h = Math.floor(m / 60), mi = m % 60;
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(mi).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}
function horaCorta(m) {
  const h = Math.floor(m / 60), mi = m % 60;
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}${mi ? ":" + String(mi).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
}
function minutosAHora(m) {
  return m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function horaAMinutos(v) {
  if (!v) return null;
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const claveCliente = (n) => n.trim().toLowerCase().replace(/\s+/g, " ");

// ---------- Reglas de negocio (iguales a la app del celular) ----------

const fechaCobro = (t) => sumarDias(t.fecha, DIAS_PARA_COBRO);
const saldo = (t) => (t.pagado ? 0 : Math.max(0, t.precio - t.anticipo));
const cobrado = (t) => (t.estado === "NO_REALIZADO" ? 0 : t.pagado ? t.precio : Math.min(t.anticipo, t.precio));
const cobroAbierto = (t) => t.estado !== "NO_REALIZADO" && !t.pagado && t.precio > 0;
const tiposTexto = (t) => Object.keys(TIPOS).filter((k) => t.tipos.includes(k)).map((k) => TIPOS[k]).join(" + ");
const reglasRecibo = { saldo, fechaCobro, hoy: hoyISO, dinero, tiposTexto, modalidad: (t) => MODALIDAD[t.modalidad] };

function totalesPorMoneda(lista) {
  const res = {};
  for (const t of lista) {
    if (t.estado === "NO_REALIZADO") continue;
    const tot = (res[t.moneda] ??= { ingresos: 0, cobrado: 0, porCobrar: 0, agendado: 0 });
    tot.cobrado += cobrado(t);
    if (t.estado === "REALIZADO") {
      tot.ingresos += t.precio;
      tot.porCobrar += saldo(t);
    } else {
      tot.agendado += t.precio;
    }
  }
  return res;
}

function normalizar(id, d) {
  return {
    uuid: id,
    cliente: d.cliente ?? "",
    titulo: d.titulo ?? "",
    fecha: d.fecha,
    horaInicio: d.horaInicio ?? null,
    horaFin: d.horaFin ?? null,
    tipos: d.tipos ?? [],
    modalidad: d.modalidad ?? "OTRO",
    precio: Number(d.precio ?? 0),
    moneda: d.moneda ?? "USD",
    anticipo: Number(d.anticipo ?? 0),
    notas: d.notas ?? "",
    estado: d.estado ?? "PENDIENTE",
    pagado: !!d.pagado,
    actualizado: d.actualizado ?? 0,
  };
}

// ---------- Sesión ----------

$("#btn-entrar").onclick = async () => {
  $("#error-entrar").textContent = "";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    $("#error-entrar").textContent = "No se pudo entrar: " + e.message;
  }
};
$("#btn-salir").onclick = () => signOut(auth);

// ---------- Tema: Claro / Oscuro / Automático (sigue al sistema) ----------
const TEMAS = { auto: "◐ Automático", oscuro: "☾ Oscuro", claro: "☀ Claro" };
const sistemaOscuro = matchMedia("(prefers-color-scheme: dark)");
function leerTema() {
  try { return localStorage.getItem("tema") || "auto"; } catch { return "auto"; }
}
function aplicarTema() {
  const t = leerTema();
  const oscuro = t === "oscuro" || (t === "auto" && sistemaOscuro.matches);
  document.documentElement.dataset.tema = oscuro ? "oscuro" : "claro";
  $("#btn-tema").textContent = TEMAS[t];
}
$("#btn-tema").onclick = () => {
  const orden = ["auto", "oscuro", "claro"];
  const sig = orden[(orden.indexOf(leerTema()) + 1) % orden.length];
  try { localStorage.setItem("tema", sig); } catch {}
  aplicarTema();
};
sistemaOscuro.addEventListener("change", aplicarTema);
aplicarTema();

onAuthStateChanged(auth, async (u) => {
  estado.dejarDeEscuchar?.();
  estado.dejarDeEscucharGastos?.();
  estado.dejarDeEscucharGastos = null;
  estado.dejarDeEscucharDepositos?.();
  estado.dejarDeEscucharDepositos = null;
  estado.depositos = [];
  estado.gastos = [];
  if (!u) {
    $("#entrar").classList.remove("oculto");
    $("#app").classList.add("oculto");
    return;
  }
  const email = (u.email || "").toLowerCase();
  let sesion = { email, duenoUid: u.uid, duenoEmail: email, soloLectura: false };
  try {
    const acceso = await getDoc(doc(db, "accesos", email));
    if (acceso.exists() && acceso.data().owner !== u.uid) {
      const propios = await getDocs(query(collection(db, "users", u.uid, "trabajos"), limit(1)));
      if (propios.empty) {
        sesion = { email, duenoUid: acceso.data().owner, duenoEmail: acceso.data().ownerEmail || "", soloLectura: true };
      }
    }
    if (!sesion.soloLectura) await setDoc(doc(db, "users", u.uid), { email }, { merge: true });
  } catch (e) {
    console.error(e);
  }
  estado.sesion = sesion;
  $("#correo").textContent = email;
  $("#aviso-lectura").textContent = `Estás viendo la agenda de ${sesion.duenoEmail}. Solo esa persona puede agregar o cambiar datos.`;
  $("#aviso-lectura").classList.toggle("oculto", !sesion.soloLectura);
  $("#btn-nuevo").classList.toggle("oculto", sesion.soloLectura);
  // Gastos: privados del dueño, los invitados no los ven
  $('.pestanas [data-pestana="gastos"]').classList.toggle("oculto", sesion.soloLectura);
  $("#leyenda-pago").classList.toggle("oculto", sesion.soloLectura);
  if (!sesion.soloLectura) {
    estado.dejarDeEscucharGastos = onSnapshot(collection(db, "users", u.uid, "gastos"), (snap) => {
      estado.gastos = snap.docs.map((d) => normalizarGasto(d.id, d.data()));
      pintar();
    }, (e) => alert("No se pudieron leer los gastos: " + e.message + "\nRevisa que las reglas de Firebase estén publicadas y recarga la página."));
    // Depósitos LAFISE: los escribe el programa que lee los avisos del banco en Gmail
    estado.dejarDeEscucharDepositos = onSnapshot(collection(db, "users", u.uid, "depositos"), (snap) => {
      estado.depositos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.fecha && d.monto > 0);
      pintar();
    }, (e) => console.error("Depósitos:", e));
  }
  $("#entrar").classList.add("oculto");
  $("#app").classList.remove("oculto");

  estado.dejarDeEscuchar = onSnapshot(collection(db, "users", sesion.duenoUid, "trabajos"), (snap) => {
    estado.trabajos = snap.docs
      .filter((d) => !d.data().borrado && d.data().fecha)
      .map((d) => normalizar(d.id, d.data()))
      .sort((a, b) => (a.fecha + minutosAHora(a.horaInicio)).localeCompare(b.fecha + minutosAHora(b.horaInicio)));
    pintar();
  }, (e) => alert("No se pudieron leer los datos: " + e.message));
});

// ---------- Guardar ----------

function coleccion() {
  return collection(db, "users", estado.sesion.duenoUid, "trabajos");
}
async function guardar(t) {
  if (estado.sesion.soloLectura) return;
  const { uuid, ...datos } = t;
  await setDoc(doc(coleccion(), uuid), { ...datos, actualizado: Date.now(), borrado: false });
}
async function borrar(t) {
  if (estado.sesion.soloLectura) return;
  await setDoc(doc(coleccion(), t.uuid), { borrado: true, actualizado: Date.now() });
}
function alternarRealizado(t) {
  guardar({ ...t, estado: t.estado === "REALIZADO" ? "PENDIENTE" : "REALIZADO" });
}

// ---------- Pintar ----------

document.querySelectorAll(".pestanas button").forEach((b) => {
  b.onclick = () => {
    estado.pestana = b.dataset.pestana;
    document.querySelectorAll(".pestanas button").forEach((x) => x.classList.toggle("activa", x === b));
    for (const v of ["agenda", "cobros", "gastos", "clientes"]) $("#vista-" + v).classList.toggle("oculto", v !== estado.pestana);
    pintar();
  };
});
$("#mes-ant").onclick = () => { estado.mes = new Date(estado.mes.getFullYear(), estado.mes.getMonth() - 1, 1); pintar(); };
$("#mes-sig").onclick = () => { estado.mes = new Date(estado.mes.getFullYear(), estado.mes.getMonth() + 1, 1); pintar(); };

// Deslizar el dedo sobre el calendario: izquierda = mes siguiente, derecha = mes anterior
(() => {
  let x0 = null, y0 = null;
  const cal = $("#calendario");
  cal.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  cal.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    (dx < 0 ? $("#mes-sig") : $("#mes-ant")).click();
  });
})();
$("#btn-hoy").onclick = () => { estado.mes = primerDiaMes(new Date()); estado.seleccion = hoyISO(); pintar(); };
$("#btn-nuevo").onclick = () => abrirFormulario(null, estado.seleccion);
$("#buscar").oninput = () => pintarClientes();

function pintar() {
  if (estado.pestana === "agenda") pintarAgenda();
  if (estado.pestana === "cobros") pintarCobros();
  if (estado.pestana === "clientes") pintarClientes();
  if (estado.pestana === "gastos") pintarGastos();
  $("#clientes-lista").innerHTML = [...new Set(estado.trabajos.map((t) => t.cliente.trim()))]
    .map((c) => `<option value="${esc(c)}">`).join("");
}

function etiquetaEstado(t) {
  if (t.estado === "NO_REALIZADO") return `<span class="etiqueta e-no">No realizado</span>`;
  if (t.pagado) return `<span class="etiqueta e-pagado">Pagado</span>`;
  if (t.estado === "REALIZADO") return `<span class="etiqueta e-realizado">Realizado · por cobrar</span>`;
  return `<span class="etiqueta e-agendado">Agendado</span>`;
}

function tarjeta(t, conFecha = false) {
  const el = document.createElement("div");
  el.className = "trabajo";
  const detalle = [conFecha ? fechaCorta(t.fecha) : null, minutosATexto(t.horaInicio) || null, t.titulo || MODALIDAD[t.modalidad]]
    .filter(Boolean).join(" · ");
  const anticipo = t.anticipo > 0 && !t.pagado && t.estado !== "NO_REALIZADO" ? `<small>Anticipo ${dinero(t.anticipo, t.moneda)}</small>` : "";
  el.innerHTML = `
    <button class="check ${t.estado === "REALIZADO" ? "si" : ""}" title="¿Se realizó?">${t.estado === "REALIZADO" ? "✓" : ""}</button>
    <div class="info">
      <div class="cliente">${esc(t.cliente)}</div>
      <div class="detalle">${esc(detalle)}</div>
      ${t.tipos.length ? `<div class="tipos">${esc(tiposTexto(t))}</div>` : ""}
      ${etiquetaEstado(t)}
    </div>
    <div class="monto">${dinero(t.precio, t.moneda)}${anticipo}</div>`;
  const check = el.querySelector(".check");
  check.disabled = estado.sesion.soloLectura;
  check.onclick = (e) => { e.stopPropagation(); alternarRealizado(t); };
  el.onclick = () => abrirFormulario(t);
  return el;
}

// Cada cifra del resumen y los trabajos que la forman
const METRICAS = {
  ingresos: { etiqueta: "Ingresos", monto: (t) => (t.estado === "REALIZADO" ? t.precio : 0) },
  porCobrar: { etiqueta: "Por cobrar", monto: (t) => (t.estado === "REALIZADO" ? saldo(t) : 0) },
  cobrado: { etiqueta: "Cobrado", monto: (t) => (t.estado !== "NO_REALIZADO" ? cobrado(t) : 0) },
  agendado: { etiqueta: "Agendado", monto: (t) => (t.estado === "PENDIENTE" ? t.precio : 0) },
};
const ambitos = {};

function bloqueTotales(totales, lista, ambito) {
  ambitos[ambito] = lista;
  const monedas = Object.keys(totales);
  if (!monedas.length) return `<p class="vacio">Todavía no hay trabajos.</p>`;
  const cifra = (clave, m, valor, color) =>
    `<button class="cifra" data-metrica="${clave}" data-moneda="${m}" data-ambito="${esc(ambito)}">
      <small>${METRICAS[clave].etiqueta}</small><b style="color:${color}">${dinero(valor, m)}</b></button>`;
  return monedas.map((m) => {
    const t = totales[m];
    return `<div class="moneda-titulo">${MONEDA[m].nombre}</div>
      <div class="cifras">
        ${cifra("ingresos", m, t.ingresos, "var(--verde)")}
        ${cifra("porCobrar", m, t.porCobrar, "var(--amarillo-texto)")}
        ${cifra("cobrado", m, t.cobrado, "var(--azul)")}
        ${cifra("agendado", m, t.agendado, "var(--tinta)")}
      </div>`;
  }).join("");
}

document.addEventListener("click", (e) => {
  const b = e.target.closest(".cifra[data-metrica]");
  if (!b) return;
  e.stopPropagation();
  const { metrica, moneda, ambito } = b.dataset;
  const filas = (ambitos[ambito] || [])
    .filter((t) => t.moneda === moneda)
    .map((t) => [t, METRICAS[metrica].monto(t)])
    .filter(([, monto]) => monto > 0)
    .sort((a, b2) => b2[0].fecha.localeCompare(a[0].fecha));
  $("#detalle-titulo").textContent = `${METRICAS[metrica].etiqueta} · ${MONEDA[moneda].nombre}`;
  const cont = $("#detalle-lista");
  cont.innerHTML = filas.length ? "" : `<p class="vacio">No hay trabajos en esta cifra.</p>`;
  for (const [t, monto] of filas) {
    const fila = document.createElement("div");
    fila.className = "detalle-fila";
    fila.innerHTML = `<div><b>${esc(t.cliente)}</b><div class="nota">${fechaCorta(t.fecha)} · ${esc(t.titulo || MODALIDAD[t.modalidad])}</div></div>
      <b>${dinero(monto, moneda)}</b>`;
    fila.onclick = () => { $("#dlg-detalle").close(); abrirFormulario(t); };
    cont.appendChild(fila);
  }
  if (filas.length) {
    cont.insertAdjacentHTML("beforeend", `<div class="detalle-total"><span>Total (${filas.length})</span>
      <b>${dinero(filas.reduce((s, [, m]) => s + m, 0), moneda)}</b></div>`);
  }
  $("#dlg-detalle").showModal();
});

function claseEstado(t) {
  if (t.estado === "NO_REALIZADO") return "ev-no";
  if (t.pagado) return "ev-pagado";
  if (t.estado === "REALIZADO") return "ev-realizado";
  return "ev-agendado";
}

function pintarAgenda() {
  const mes = estado.mes;
  // Solo el mes, como en la app
  const titulo = mes.toLocaleDateString("es-NI", { month: "long" });
  $("#mes-titulo").textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  const cal = $("#calendario");
  cal.innerHTML = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d) => `<div class="cab">${d}</div>`).join("");
  // Semana empieza el domingo
  const desfase = mes.getDay();
  const inicio = new Date(mes.getFullYear(), mes.getMonth(), 1 - desfase);
  const diasMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
  const semanas = Math.ceil((desfase + diasMes) / 7);
  cal.style.gridTemplateRows = `auto repeat(${semanas}, minmax(0, 1fr))`;
  const hoy = hoyISO();
  const maxVisibles = 3;
  // Gastos sin pagar (solo el dueño): se ven en naranja para no confundirlos con los cobros
  const porPagar = estado.sesion.soloLectura ? [] : [-1, 0, 1]
    .flatMap((k) => gastosDelMes(iso(new Date(mes.getFullYear(), mes.getMonth() + k, 1)).slice(0, 7)))
    .filter((g) => !g.pagado);
  for (let i = 0; i < semanas * 7; i++) {
    const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    const s = iso(d);
    const delDia = estado.trabajos.filter((t) => t.fecha === s);
    const cobrosDia = estado.trabajos.filter((t) => cobroAbierto(t) && fechaCobro(t) === s);
    // El número toma el color del estado más importante del día
    const marca = cobrosDia.length ? (s < hoy ? "m-vencido" : "m-cobro")
      : delDia.some((t) => t.estado === "PENDIENTE") ? "m-agendado"
      : delDia.some((t) => t.estado === "REALIZADO") ? "m-realizado" : "";
    const celda = document.createElement("div");
    celda.className = "dia" + (d.getMonth() !== mes.getMonth() ? " fuera" : "") + (d.getDay() === 0 ? " domingo" : "") +
      (s === hoy ? " hoy" : "") + (s === estado.seleccion ? " sel" : "") + (marca ? " " + marca : "");
    celda.innerHTML = `<span class="num">${d.getDate()}</span>`;
    const items = [
      ...delDia.map((t) => ({ t, html: `${t.horaInicio != null ? `<b>${horaCorta(t.horaInicio)}</b> ` : ""}${esc(t.cliente)}`, clase: claseEstado(t) })),
      ...cobrosDia.map((t) => ({ t, html: `Cobrar a ${esc(t.cliente)}`, clase: "ev-cobro" })),
      ...porPagar.filter((g) => g.fecha === s).map((g) => ({ g, html: `${gastoVencido(g) ? "⚠ " : ""}Pagar ${esc(tituloGasto(g))}`, clase: "ev-pago" })),
    ];
    items.slice(0, maxVisibles).forEach(({ t, g, html, clase }) => {
      const ev = document.createElement("div");
      ev.className = "evento " + clase;
      ev.innerHTML = html;
      ev.title = g ? `${tituloGasto(g)} · ${dinero(g.monto, g.moneda)} · sin pagar`
        : `${t.cliente} · ${t.titulo || MODALIDAD[t.modalidad]} · ${dinero(t.precio, t.moneda)}`;
      ev.onclick = (e) => { e.stopPropagation(); g ? abrirGasto(g) : abrirFormulario(t); };
      celda.appendChild(ev);
    });
    if (items.length > maxVisibles) {
      celda.insertAdjacentHTML("beforeend", `<div class="mas">+${items.length - maxVisibles} más</div>`);
    }
    celda.onclick = () => { estado.seleccion = s; pintarAgenda(); };
    celda.ondblclick = () => { if (!estado.sesion.soloLectura) abrirFormulario(null, s); };
    cal.appendChild(celda);
  }

  const prefijo = iso(mes).slice(0, 7);
  const delMes = estado.trabajos.filter((t) => t.fecha.startsWith(prefijo));
  $("#resumen-mes").innerHTML = `<h4>Resumen del mes · ${delMes.filter((t) => t.estado !== "NO_REALIZADO").length} trabajos</h4>` +
    botonDepositos(prefijo) + bloqueTotales(totalesPorMoneda(delMes), delMes, "mes") + bloqueGanancia(totalesPorMoneda(delMes), gastosDelMes(iso(mes).slice(0, 7)));

  $("#dia-titulo").textContent = fechaLarga(estado.seleccion);
  const lista = $("#lista-dia");
  lista.innerHTML = "";
  const delDia = estado.trabajos.filter((t) => t.fecha === estado.seleccion);
  const cobrosDia = estado.trabajos.filter((t) => cobroAbierto(t) && fechaCobro(t) === estado.seleccion);
  if (!delDia.length && !cobrosDia.length) {
    lista.innerHTML = `<p class="vacio">Sin trabajos este día.${estado.sesion.soloLectura ? "" : " Haz doble clic en un día del calendario para agendar."}</p>`;
  }
  delDia.forEach((t) => lista.appendChild(tarjeta(t)));
  cobrosDia.forEach((t) => {
    const el = document.createElement("div");
    el.className = "cobro-dia";
    el.innerHTML = `<div><b>Cobrar a ${esc(t.cliente)}</b><br><small>Trabajo del ${fechaCorta(t.fecha)}</small></div><b>${dinero(saldo(t), t.moneda)}</b>`;
    el.onclick = () => abrirFormulario(t);
    lista.appendChild(el);
  });
}

function pintarCobros() {
  const hoy = hoyISO();
  const abiertos = estado.trabajos.filter(cobroAbierto).sort((a, b) => fechaCobro(a).localeCompare(fechaCobro(b)));
  $("#cobros-totales").innerHTML = Object.keys(MONEDA).map((m) => {
    const total = abiertos.filter((t) => t.moneda === m).reduce((s, t) => s + saldo(t), 0);
    return total > 0 ? `<div class="cifra"><small>Por cobrar ${MONEDA[m].simbolo}</small><b style="color:var(--amarillo-texto)">${dinero(total, m)}</b></div>` : "";
  }).join("");
  const lista = $("#lista-cobros");
  lista.innerHTML = abiertos.length ? "" : `<p class="vacio">No tienes cobros pendientes.</p>`;
  let seccion = null;
  for (const t of abiertos) {
    const fc = fechaCobro(t);
    const dias = Math.round((desdeISO(fc) - desdeISO(hoy)) / 86400000);
    const s = dias < 0 ? "Vencidos" : "Próximos";
    if (s !== seccion) {
      seccion = s;
      lista.insertAdjacentHTML("beforeend", `<h4 class="seccion" style="color:${dias < 0 ? "var(--rojo)" : "var(--azul)"}">${s}</h4>`);
    }
    const cuando = dias < 0 ? `Venció hace ${-dias} día${dias < -1 ? "s" : ""}` : dias === 0 ? "Vence hoy" : dias === 1 ? "Vence mañana" : `Vence en ${dias} días · ${fechaCorta(fc)}`;
    const el = document.createElement("div");
    el.className = "cobro" + (dias < 0 ? " vencido" : "");
    el.innerHTML = `<div class="info"><b>${esc(t.cliente)}</b><div class="nota">${esc(t.titulo || MODALIDAD[t.modalidad])} · ${fechaCorta(t.fecha)}</div>
      <div class="cuando">${cuando}</div>${t.estado === "PENDIENTE" ? '<div class="nota">Falta confirmar si se realizó</div>' : ""}</div>
      <b>${dinero(saldo(t), t.moneda)}</b><button class="btn borde recibo" title="Enviar cobro al cliente">Cobro JPG</button>${estado.sesion.soloLectura ? "" : '<button class="btn pagado">Pagado</button>'}`;
    el.querySelector(".info").onclick = () => abrirFormulario(t);
    el.querySelector(".recibo").onclick = () => enviarRecibo(t, reglasRecibo);
    const btn = el.querySelector(".pagado");
    if (btn) btn.onclick = () => guardar({ ...t, pagado: true });
    lista.appendChild(el);
  }
}

function pintarClientes() {
  $("#total-general").innerHTML = bloqueTotales(totalesPorMoneda(estado.trabajos), estado.trabajos, "general");
  const filtro = $("#buscar").value.trim().toLowerCase();
  const grupos = {};
  for (const t of estado.trabajos) (grupos[claveCliente(t.cliente)] ??= []).push(t);
  const lista = $("#lista-clientes");
  lista.innerHTML = "";
  Object.values(grupos)
    .map((ts) => ({ nombre: ts[ts.length - 1].cliente.trim(), trabajos: ts }))
    .filter((c) => !filtro || c.nombre.toLowerCase().includes(filtro))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .forEach((c) => {
      const tot = totalesPorMoneda(c.trabajos);
      const realizados = c.trabajos.filter((t) => t.estado === "REALIZADO").length;
      const pendientes = c.trabajos.filter((t) => t.estado === "PENDIENTE").length;
      const el = document.createElement("div");
      el.className = "cliente-fila";
      el.innerHTML = `<div class="linea"><b>${esc(c.nombre)}</b><span class="nota">${realizados} realizados · ${pendientes} agendados</span></div>` +
        Object.keys(tot).map((m) => `<div class="linea"><span class="verde-t">Ingresos ${dinero(tot[m].ingresos, m)}</span>
          ${tot[m].porCobrar > 0 ? `<span class="amarillo-t">Debe ${dinero(tot[m].porCobrar, m)}</span>` : ""}</div>`).join("");
      const detalle = document.createElement("div");
      detalle.className = "lista oculto";
      detalle.insertAdjacentHTML("beforeend", bloqueTotales(tot, c.trabajos, "cliente:" + claveCliente(c.nombre)));
      [...c.trabajos].sort((a, b) => b.fecha.localeCompare(a.fecha)).forEach((t) => detalle.appendChild(tarjeta(t, true)));
      el.onclick = (e) => { if (!detalle.contains(e.target)) detalle.classList.toggle("oculto"); };
      el.appendChild(detalle);
      lista.appendChild(el);
    });
}

// ---------- Formulario ----------

const dlg = $("#dlg-trabajo");
const form = $("#form-trabajo");
let editando = null;

function abrirFormulario(t, fecha) {
  editando = t;
  const lectura = estado.sesion.soloLectura;
  form.reset();
  $("#form-titulo").textContent = lectura ? "Trabajo" : t ? "Editar trabajo" : "Nuevo trabajo";
  const v = t ?? { cliente: "", titulo: "", fecha, horaInicio: null, horaFin: null, tipos: ["FOTO"], modalidad: "EVENTO",
    moneda: localStorage.getItem("moneda") || "USD", precio: "", anticipo: "", notas: "", estado: "PENDIENTE", pagado: false };
  form.cliente.value = v.cliente;
  form.titulo.value = v.titulo;
  form.fecha.value = v.fecha;
  form.horaInicio.value = minutosAHora(v.horaInicio);
  form.horaFin.value = minutosAHora(v.horaFin);
  form.querySelectorAll('[name="tipos"]').forEach((c) => { c.checked = v.tipos.includes(c.value); });
  form.querySelector(`[name="modalidad"][value="${v.modalidad}"]`).checked = true;
  form.moneda.value = v.moneda;
  form.precio.value = v.precio === "" ? "" : v.precio;
  form.anticipo.value = v.anticipo ? v.anticipo : "";
  form.notas.value = v.notas;
  form.querySelector(`[name="estado"][value="${v.estado}"]`).checked = true;
  form.pagado.checked = v.pagado;
  form.querySelectorAll("input, select, textarea").forEach((el) => { el.disabled = lectura; });
  $("#btn-guardar").classList.toggle("oculto", lectura);
  $("#btn-borrar").classList.toggle("oculto", lectura || !t);
  actualizarSaldo();
  dlg.showModal();
}

function actualizarSaldo() {
  const precio = Number(form.precio.value || 0);
  const anticipo = Number(form.anticipo.value || 0);
  const estadoForm = form.querySelector('[name="estado"]:checked')?.value;
  $("#btn-recibo").classList.toggle("oculto", !editando || !precio || estadoForm === "NO_REALIZADO");
  $("#btn-recibo").textContent = form.pagado.checked ? "Recibo de pago JPG" : "Cobro JPG";
  if (!precio || !form.fecha.value) { $("#form-saldo").textContent = ""; return; }
  const s = form.pagado.checked ? 0 : Math.max(0, precio - anticipo);
  $("#form-saldo").textContent = `Saldo por cobrar: ${dinero(s, form.moneda.value)} · Fecha de cobro: ${fechaLarga(sumarDias(form.fecha.value, DIAS_PARA_COBRO))}`;
}
form.addEventListener("input", actualizarSaldo);

function leerFormulario() {
  const precio = Number(form.precio.value || 0);
  return {
    ...(editando ?? {}),
    uuid: editando?.uuid ?? crypto.randomUUID(),
    cliente: form.cliente.value.trim(),
    titulo: form.titulo.value.trim(),
    fecha: form.fecha.value,
    horaInicio: horaAMinutos(form.horaInicio.value),
    horaFin: form.horaInicio.value ? horaAMinutos(form.horaFin.value) : null,
    tipos: [...form.querySelectorAll('[name="tipos"]:checked')].map((c) => c.value),
    modalidad: form.querySelector('[name="modalidad"]:checked').value,
    moneda: form.moneda.value,
    precio,
    anticipo: Math.min(Number(form.anticipo.value || 0), precio),
    notas: form.notas.value.trim(),
    estado: form.querySelector('[name="estado"]:checked').value,
    pagado: form.pagado.checked,
  };
}

$("#btn-cancelar").onclick = () => dlg.close();
$("#btn-recibo").onclick = () => { if (form.cliente.value.trim()) enviarRecibo(leerFormulario(), reglasRecibo); };
$("#btn-borrar").onclick = async () => {
  if (editando && confirm("¿Borrar este trabajo? También se quitará de Google Calendar cuando se sincronice el celular.")) {
    await borrar(editando);
    dlg.close();
  }
};
form.onsubmit = async (e) => {
  e.preventDefault();
  if (estado.sesion.soloLectura) return;
  const t = leerFormulario();
  localStorage.setItem("moneda", t.moneda);
  $("#btn-guardar").disabled = true;
  try {
    await guardar(t);
    estado.seleccion = t.fecha;
    estado.mes = primerDiaMes(desdeISO(t.fecha));
    dlg.close();
  } catch (err) {
    alert("No se pudo guardar: " + err.message);
  } finally {
    $("#btn-guardar").disabled = false;
  }
};

// ---------- Gastos (privados del dueño) ----------
// users/{uid}/gastos/{id}; capturas comprimidas en users/{uid}/comprobantes/{id}. Igual que la app.

const CATEGORIAS = {
  RENTA: { etiqueta: "Renta", emoji: "🏠", fondo: "#E3EEFB", barra: "#64A0E8" },
  FIJOS: { etiqueta: "Pagos fijos", emoji: "📌", fondo: "#E2F4EB", barra: "#4CB585" },
  GASOLINA: { etiqueta: "Gasolina", emoji: "⛽", fondo: "#FFF5D6", barra: "#F2C14E" },
  PERSONALES: { etiqueta: "Pagos personales", emoji: "👤", fondo: "#F3E8FF", barra: "#A77BDB", acreedor: true },
  PRESTAMOS: { etiqueta: "Préstamos", emoji: "🤝", fondo: "#FFEDE0", barra: "#F08A4B", acreedor: true },
  // Inversión: se muestra aparte y no resta de la ganancia
  EQUIPO: { etiqueta: "Compra de equipo", emoji: "📷", fondo: "#FDECEC", barra: "#E57373", noResta: true },
};

function normalizarGasto(id, d) {
  return {
    id,
    categoria: CATEGORIAS[d.categoria] ? d.categoria : "FIJOS",
    descripcion: d.descripcion ?? "",
    acreedor: d.acreedor ?? "",
    monto: Number(d.monto ?? 0),
    moneda: d.moneda ?? "USD",
    fecha: d.fecha,
    repetir: !!d.repetir,
    serie: d.serie ?? id,
    pagado: !!d.pagado,
    notas: d.notas ?? "",
    comprobante: !!d.comprobante,
    omitido: !!d.omitido,
    actualizado: d.actualizado ?? 0,
  };
}
const tituloGasto = (g) => g.descripcion || CATEGORIAS[g.categoria].etiqueta;
const gastoVencido = (g) => !g.pagado && g.fecha < hoyISO();

/** Gastos de un mes ("2026-10"), con copias pendientes de los que se repiten cada mes. */
function gastosDelMes(ym) {
  const reales = estado.gastos.filter((g) => g.fecha.startsWith(ym));
  const conMes = new Set(reales.map((g) => g.serie));
  const series = {};
  for (const g of estado.gastos) (series[g.serie] ??= []).push(g);
  const copias = [];
  for (const [serie, lista] of Object.entries(series)) {
    if (conMes.has(serie)) continue;
    const ultimo = lista.filter((g) => g.fecha.slice(0, 7) < ym).sort((a, b) => a.fecha.localeCompare(b.fecha)).pop();
    if (!ultimo?.repetir) continue;
    const [a, m] = ym.split("-").map(Number);
    const dia = Math.min(Number(ultimo.fecha.slice(8)), new Date(a, m, 0).getDate());
    copias.push({ ...ultimo, id: `${serie}_${ym}`, fecha: `${ym}-${String(dia).padStart(2, "0")}`,
      pagado: false, comprobante: false, omitido: false, notas: "", virtual: true });
  }
  return [...reales, ...copias].filter((g) => !g.omitido).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function totalesGastos(lista) {
  const res = {};
  for (const g of lista) {
    const t = (res[g.moneda] ??= { gastos: 0, pagado: 0, pendiente: 0, equipo: 0 });
    if (CATEGORIAS[g.categoria].noResta) { t.equipo += g.monto; continue; }
    t.gastos += g.monto;
    if (g.pagado) t.pagado += g.monto; else t.pendiente += g.monto;
  }
  return res;
}

/** Botón verde con lo que ha caído en las cuentas LAFISE en el mes (solo el dueño). */
function botonDepositos(ym) {
  if (estado.sesion?.soloLectura) return "";
  const delMes = estado.depositos.filter((d) => d.fecha.startsWith(ym));
  const totales = {};
  for (const d of delMes) totales[d.moneda] = (totales[d.moneda] ?? 0) + d.monto;
  const montos = Object.keys(totales).length
    ? Object.entries(totales).map(([m, v]) => `<b>${dinero(v, m)}</b>`).join("")
    : `<b>${dinero(0, "USD")}</b>`;
  return `<button class="btn-depositos" data-ym="${ym}">
    <small>🏦 Depositado este mes · LAFISE 🔒</small>${montos}
    <span>${delMes.length} ${delMes.length === 1 ? "transferencia" : "transferencias"} ›</span></button>`;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest(".btn-depositos");
  if (!b) return;
  e.stopPropagation();
  const lista = estado.depositos.filter((d) => d.fecha.startsWith(b.dataset.ym)).sort((x, y) => y.fecha.localeCompare(x.fecha));
  $("#detalle-titulo").textContent = "Depósitos recibidos · LAFISE";
  const cont = $("#detalle-lista");
  cont.innerHTML = lista.length ? "" : `<p class="vacio">Todavía no ha caído ninguna transferencia este mes.</p>`;
  for (const d of lista) {
    cont.insertAdjacentHTML("beforeend", `<div class="detalle-fila"><div><b>${esc(d.de || "Transferencia")}</b>
      <div class="nota">${fechaCorta(d.fecha.slice(0, 10))}${d.motivo ? " · " + esc(d.motivo) : ""}${d.referencia ? " · Ref. " + esc(d.referencia) : ""}</div></div>
      <b style="color:var(--verde)">${dinero(d.monto, d.moneda)}</b></div>`);
  }
  const totales = {};
  for (const d of lista) totales[d.moneda] = (totales[d.moneda] ?? 0) + d.monto;
  for (const [m, v] of Object.entries(totales)) {
    cont.insertAdjacentHTML("beforeend", `<div class="detalle-total"><span>Total ${MONEDA[m].nombre}</span><b>${dinero(v, m)}</b></div>`);
  }
  $("#dlg-detalle").showModal();
});

function bloqueGanancia(totTrabajos, gastosMes) {
  if (estado.sesion?.soloLectura || !gastosMes.length) return "";
  const tg = totalesGastos(gastosMes);
  const html = Object.keys(tg).map((m) => {
    const t = tg[m];
    const neta = (totTrabajos[m]?.ingresos ?? 0) - t.gastos;
    return `<div class="moneda-titulo">${MONEDA[m].nombre} · gastos 🔒</div>
      <div class="cifras">
        <div class="cifra"><small>Gastos del mes</small><b style="color:#C62828">− ${dinero(t.gastos, m)}</b></div>
        <div class="cifra"><small>De esos, sin pagar</small><b style="color:#B26A00">${dinero(t.pendiente, m)}</b></div>
        <div class="cifra neta"><small>Ganancia neta del mes (ingresos − gastos)</small><b style="color:${neta < 0 ? "#C62828" : "var(--menta-texto)"}">${dinero(neta, m)}</b></div>
        ${t.equipo ? `<div class="cifra neta-equipo"><small>📷 Invertido en equipo (no se resta)</small><b style="color:var(--azul)">${dinero(t.equipo, m)}</b></div>` : ""}
      </div>`;
  }).join("");
  // Barras por categoría (solo lo que se resta)
  const porCat = {};
  for (const g of gastosMes) if (!CATEGORIAS[g.categoria].noResta) porCat[g.categoria + "|" + g.moneda] = (porCat[g.categoria + "|" + g.moneda] ?? 0) + g.monto;
  const filas = Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
    const [c, m] = k.split("|");
    const pct = Math.max(3, Math.round((v / (tg[m]?.gastos || v)) * 100));
    return `<div class="barra-cat"><span>${CATEGORIAS[c].emoji} ${CATEGORIAS[c].etiqueta}</span><b>${dinero(v, m)}</b>
      <i><em style="width:${pct}%;background:${CATEGORIAS[c].barra}"></em></i></div>`;
  }).join("");
  return html + (filas ? `<h4 class="seccion">Gastos por categoría</h4>${filas}` : "");
}

function pintarGastos() {
  const mes = estado.mesGastos;
  const nombre = mes.toLocaleDateString("es-NI", { month: "long" });
  $("#gastos-mes").textContent = nombre.charAt(0).toUpperCase() + nombre.slice(1);
  const delMes = gastosDelMes(iso(mes).slice(0, 7));
  const tg = totalesGastos(delMes);
  $("#gastos-totales").innerHTML = Object.keys(tg).length ? Object.keys(tg).map((m) => {
    const t = tg[m];
    return `<div class="total-gastos"><small>Gastos del mes · ${MONEDA[m].nombre} (se restan)</small><b>${dinero(t.gastos, m)}</b>
      <span>Pagado ${dinero(t.pagado, m)} · Pendiente ${dinero(t.pendiente, m)}</span>
      ${t.equipo ? `<div class="equipo">📷 Invertido en equipo: ${dinero(t.equipo, m)} <span>(no se resta)</span></div>` : ""}</div>`;
  }).join("") : `<p class="vacio">No hay gastos este mes. Toca “+ Nuevo gasto” para agregar uno.</p>`;

  const filtros = $("#gastos-filtros");
  filtros.innerHTML = [["", "Todos"], ...Object.entries(CATEGORIAS).map(([k, c]) => [k, `${c.emoji} ${c.etiqueta}`])]
    .map(([k, t]) => `<button class="chip-filtro${(estado.filtroGasto ?? "") === k ? " activo" : ""}" data-cat="${k}">${t}</button>`).join("");
  filtros.querySelectorAll("button").forEach((b) => { b.onclick = () => { estado.filtroGasto = b.dataset.cat || null; pintarGastos(); }; });

  const visibles = delMes.filter((g) => !estado.filtroGasto || g.categoria === estado.filtroGasto);
  const pendientes = visibles.filter((g) => !g.pagado).sort((a, b) => (gastoVencido(b) - gastoVencido(a)) || a.fecha.localeCompare(b.fecha));
  const pagados = visibles.filter((g) => g.pagado).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const lista = $("#lista-gastos");
  lista.innerHTML = "";
  const seccion = (titulo, color, gs) => {
    if (!gs.length) return;
    lista.insertAdjacentHTML("beforeend", `<h4 class="seccion" style="color:${color}">${titulo}</h4>`);
    gs.forEach((g) => lista.appendChild(filaGasto(g)));
  };
  seccion("Pendientes", "#B26A00", pendientes);
  seccion("Pagados", "var(--verde)", pagados);
}

function filaGasto(g) {
  const c = CATEGORIAS[g.categoria];
  const venc = gastoVencido(g);
  const linea = [c.etiqueta, g.acreedor && `a: ${esc(g.acreedor)}`, (g.pagado ? "" : venc ? "venció " : "vence ") + fechaCorta(g.fecha),
    g.repetir && "cada mes", g.comprobante && "🧾"].filter(Boolean).join(" · ");
  const color = c.noResta ? "var(--azul)" : g.pagado ? "var(--verde)" : venc ? "#C62828" : "#B26A00";
  const el = document.createElement("div");
  el.className = "gasto" + (venc ? " vencido" : "");
  el.innerHTML = `<div class="ic-cat" style="background:${c.fondo}">${c.emoji}</div>
    <div class="info"><b>${esc(tituloGasto(g))}</b><div class="nota">${linea}</div></div>
    <div class="monto"><b style="color:${color}">${dinero(g.monto, g.moneda)}</b>
      ${c.noResta && g.pagado ? '<small style="color:var(--azul)">Inversión</small>' : g.pagado ? '<small style="color:var(--verde)">✓ Pagado</small>' : '<button class="btn pagado">Pagado</button>'}</div>`;
  el.onclick = () => abrirGasto(g);
  el.querySelector(".pagado")?.addEventListener("click", (e) => { e.stopPropagation(); guardarGasto({ ...g, pagado: true }).catch((err) => alert("No se pudo guardar: " + err.message)); });
  return el;
}

const colGastos = () => collection(db, "users", auth.currentUser.uid, "gastos");
const colComprobantes = () => collection(db, "users", auth.currentUser.uid, "comprobantes");

async function guardarGasto(g, imagen) {
  if (estado.sesion.soloLectura) return;
  const { id, virtual, ...datos } = g;
  if (imagen === "") datos.comprobante = false;
  else if (imagen) datos.comprobante = true;
  await setDoc(doc(colGastos(), id), { ...datos, actualizado: Date.now() });
  if (imagen === "") await deleteDoc(doc(colComprobantes(), id));
  else if (imagen) await setDoc(doc(colComprobantes(), id), { imagen, actualizado: Date.now() });
}

async function borrarGasto(g, soloEsteMes) {
  const serie = estado.gastos.filter((x) => x.serie === g.serie);
  if (g.comprobante) await deleteDoc(doc(colComprobantes(), g.id));
  if (soloEsteMes && (g.repetir || g.virtual)) return guardarGasto({ ...g, omitido: true, comprobante: false });
  if (!g.virtual) await deleteDoc(doc(colGastos(), g.id));
  if (g.repetir || g.virtual) {
    for (const x of serie.filter((x) => x.fecha > g.fecha)) await deleteDoc(doc(colGastos(), x.id));
    const previo = serie.filter((x) => x.fecha < g.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha)).pop();
    if (previo?.repetir) await guardarGasto({ ...previo, repetir: false });
  }
}

/** Reduce la captura a JPEG de menos de ~700 KB en base64 (un documento admite 1 MB). */
async function comprimirCaptura(archivo) {
  const img = await createImageBitmap(archivo);
  for (const lado of [1400, 1050, 800, 600]) {
    const escala = Math.min(1, lado / Math.max(img.width, img.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(img.width * escala);
    lienzo.height = Math.round(img.height * escala);
    lienzo.getContext("2d").drawImage(img, 0, 0, lienzo.width, lienzo.height);
    for (const calidad of [0.8, 0.7, 0.6, 0.5]) {
      const texto = lienzo.toDataURL("image/jpeg", calidad).split(",")[1];
      if (texto.length < 700000) return texto;
    }
  }
  return null;
}

const dlgGasto = $("#dlg-gasto");
const formGasto = $("#form-gasto");
let gastoEditando = null;
let imagenGasto; // undefined = sin cambios, "" = quitar, texto = nueva

formGasto.querySelector(".cats").innerHTML = Object.entries(CATEGORIAS)
  .map(([k, c]) => `<label class="chip"><input type="radio" name="categoria" value="${k}">${c.emoji} ${c.etiqueta}</label>`).join("");

function actualizarFormGasto() {
  const cat = CATEGORIAS[formGasto.querySelector('[name="categoria"]:checked')?.value ?? "FIJOS"];
  $("#campo-acreedor").classList.toggle("oculto", !cat.acreedor);
  $("#aviso-equipo").classList.toggle("oculto", !cat.noResta);
}
formGasto.addEventListener("input", actualizarFormGasto);

function mostrarMiniatura(base64) {
  const mini = $("#mini-comprobante");
  mini.innerHTML = base64 ? `<img src="data:image/jpeg;base64,${base64}" alt="Comprobante">` : "🧾";
  mini.classList.toggle("con-imagen", !!base64);
  $("#btn-quitar-captura").classList.toggle("oculto", !base64);
  $("#btn-captura-texto").textContent = base64 ? "Cambiar captura" : "Adjuntar captura";
}

async function abrirGasto(g) {
  gastoEditando = g;
  imagenGasto = undefined;
  formGasto.reset();
  const ym = iso(estado.mesGastos).slice(0, 7);
  const v = g ?? { categoria: "FIJOS", descripcion: "", acreedor: "", monto: "", moneda: localStorage.getItem("moneda") || "USD",
    fecha: hoyISO().startsWith(ym) ? hoyISO() : `${ym}-01`, repetir: false, pagado: false, notas: "" };
  $("#gasto-titulo").textContent = g ? "Editar gasto" : "Nuevo gasto";
  formGasto.querySelector(`[name="categoria"][value="${v.categoria}"]`).checked = true;
  formGasto.descripcion.value = v.descripcion;
  formGasto.acreedor.value = v.acreedor;
  formGasto.moneda.value = v.moneda;
  formGasto.monto.value = v.monto;
  formGasto.fecha.value = v.fecha;
  formGasto.repetir.checked = v.repetir;
  formGasto.pagado.checked = v.pagado;
  formGasto.notas.value = v.notas;
  $("#btn-borrar-gasto").classList.toggle("oculto", !g);
  actualizarFormGasto();
  mostrarMiniatura(null);
  dlgGasto.showModal();
  if (g?.comprobante) {
    $("#mini-comprobante").textContent = "…";
    const d = await getDoc(doc(colComprobantes(), g.id));
    if (gastoEditando === g) mostrarMiniatura(d.data()?.imagen ?? null);
  }
}

$("#gastos-ant").onclick = () => { estado.mesGastos = new Date(estado.mesGastos.getFullYear(), estado.mesGastos.getMonth() - 1, 1); pintarGastos(); };
$("#gastos-sig").onclick = () => { estado.mesGastos = new Date(estado.mesGastos.getFullYear(), estado.mesGastos.getMonth() + 1, 1); pintarGastos(); };
$("#btn-nuevo-gasto").onclick = () => abrirGasto(null);
$("#btn-cancelar-gasto").onclick = () => dlgGasto.close();
$("#btn-captura").onclick = () => $("#archivo-captura").click();
$("#archivo-captura").onchange = async (e) => {
  const archivo = e.target.files[0];
  e.target.value = "";
  if (!archivo) return;
  $("#mini-comprobante").textContent = "…";
  const texto = await comprimirCaptura(archivo).catch(() => null);
  if (!texto) { alert("No se pudo leer la imagen."); mostrarMiniatura(null); return; }
  imagenGasto = texto;
  formGasto.pagado.checked = true;
  mostrarMiniatura(texto);
};
$("#btn-quitar-captura").onclick = () => { imagenGasto = ""; mostrarMiniatura(null); };
$("#mini-comprobante").onclick = () => {
  const img = $("#mini-comprobante img");
  if (!img) return;
  $("#comprobante-grande").src = img.src;
  $("#dlg-comprobante").showModal();
};
$("#dlg-comprobante").onclick = () => $("#dlg-comprobante").close();
$("#btn-borrar-gasto").onclick = async () => {
  const g = gastoEditando;
  if (!g) return;
  if (g.repetir || g.virtual) {
    const r = prompt("Este gasto se repite cada mes.\nEscribe 1 para quitarlo solo de este mes, o 2 para quitarlo de este mes en adelante.");
    if (r !== "1" && r !== "2") return;
    await borrarGasto(g, r === "1");
  } else {
    if (!confirm("¿Borrar este gasto?")) return;
    await borrarGasto(g, false);
  }
  dlgGasto.close();
};
formGasto.onsubmit = async (e) => {
  e.preventDefault();
  const monto = Number(formGasto.monto.value || 0);
  if (!(monto > 0)) return;
  const categoria = formGasto.querySelector('[name="categoria"]:checked').value;
  const base = gastoEditando ?? { id: crypto.randomUUID(), comprobante: false, omitido: false };
  const g = {
    ...base,
    serie: base.serie ?? base.id,
    categoria,
    descripcion: formGasto.descripcion.value.trim(),
    acreedor: CATEGORIAS[categoria].acreedor ? formGasto.acreedor.value.trim() : "",
    monto,
    moneda: formGasto.moneda.value,
    fecha: formGasto.fecha.value,
    repetir: formGasto.repetir.checked,
    pagado: formGasto.pagado.checked,
    notas: formGasto.notas.value.trim(),
  };
  dlgGasto.close();
  try {
    await guardarGasto(g, imagenGasto);
  } catch (err) {
    alert("No se pudo guardar el gasto: " + err.message);
  }
};

// ---------- Selector de fecha propio: la semana empieza en domingo, como la agenda ----------
// El calendario del navegador sigue la región del sistema (en muchos, lunes primero).
// El campo de fecha original queda escondido y guarda el valor (yyyy-mm-dd).

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const valorNativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

function selectorFecha(input) {
  input.type = "hidden";
  input.removeAttribute("required");
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "campo-fecha";
  input.after(boton);
  const caja = document.createElement("div");
  caja.className = "selector-fecha oculto";
  boton.after(caja);
  let mes = null;

  const pintarBoton = () => {
    const v = valorNativo.get.call(input);
    if (!v) { boton.innerHTML = `<span class="vacio-fecha">Elegir fecha</span><i>📅</i>`; return; }
    const [a, m, d] = v.split("-").map(Number);
    boton.innerHTML = `<span>${DIAS_CORTOS[new Date(a, m - 1, d).getDay()]}, ${d} ${MESES_CORTOS[m - 1]} ${a}</span><i>📅</i>`;
  };
  // Cuando el código pone la fecha (al abrir un trabajo o gasto) se actualiza lo que se ve
  Object.defineProperty(input, "value", {
    get: () => valorNativo.get.call(input),
    set: (v) => { valorNativo.set.call(input, v); pintarBoton(); },
  });

  const pintarCaja = () => {
    const elegido = valorNativo.get.call(input);
    const hoy = hoyISO();
    const titulo = mes.toLocaleDateString("es-NI", { month: "long", year: "numeric" });
    const inicio = new Date(mes.getFullYear(), mes.getMonth(), 1 - mes.getDay());
    let dias = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
      const s = iso(d);
      const clases = ["dia-sel"];
      if (d.getMonth() !== mes.getMonth()) clases.push("fuera");
      if (d.getDay() === 0) clases.push("domingo");
      if (s === hoy) clases.push("hoy");
      if (s === elegido) clases.push("elegido");
      dias += `<button type="button" class="${clases.join(" ")}" data-fecha="${s}">${d.getDate()}</button>`;
    }
    caja.innerHTML = `<div class="sel-cab"><button type="button" class="sel-nav" data-mover="-1">‹</button>
      <b>${titulo.charAt(0).toUpperCase() + titulo.slice(1)}</b><button type="button" class="sel-nav" data-mover="1">›</button></div>
      <div class="sel-grilla">${["D", "L", "M", "M", "J", "V", "S"].map((x) => `<span>${x}</span>`).join("")}${dias}</div>
      <div class="sel-pie"><button type="button" class="sel-hoy">Hoy</button></div>`;
  };

  const elegir = (s) => {
    input.value = s;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    caja.classList.add("oculto");
  };

  boton.addEventListener("click", (e) => {
    e.preventDefault();
    if (!caja.classList.contains("oculto")) { caja.classList.add("oculto"); return; }
    const v = valorNativo.get.call(input) || hoyISO();
    const [a, m] = v.split("-").map(Number);
    mes = new Date(a, m - 1, 1);
    pintarCaja();
    caja.classList.remove("oculto");
  });
  caja.addEventListener("click", (e) => {
    e.preventDefault(); // que el clic no active la etiqueta del campo
    e.stopPropagation(); // al cambiar de mes se redibuja y el clic no debe cerrarlo
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.mover) { mes = new Date(mes.getFullYear(), mes.getMonth() + Number(b.dataset.mover), 1); pintarCaja(); }
    else if (b.dataset.fecha) elegir(b.dataset.fecha);
    else if (b.classList.contains("sel-hoy")) elegir(hoyISO());
  });
  document.addEventListener("click", (e) => {
    if (!caja.contains(e.target) && !boton.contains(e.target)) caja.classList.add("oculto");
  });
  pintarBoton();
}

document.querySelectorAll('dialog input[name="fecha"]').forEach(selectorFecha);
