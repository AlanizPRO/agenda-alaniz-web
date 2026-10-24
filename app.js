import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, limit, onSnapshot, query, setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

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

onAuthStateChanged(auth, async (u) => {
  estado.dejarDeEscuchar?.();
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
    for (const v of ["agenda", "cobros", "clientes"]) $("#vista-" + v).classList.toggle("oculto", v !== estado.pestana);
    pintar();
  };
});
$("#mes-ant").onclick = () => { estado.mes = new Date(estado.mes.getFullYear(), estado.mes.getMonth() - 1, 1); pintar(); };
$("#mes-sig").onclick = () => { estado.mes = new Date(estado.mes.getFullYear(), estado.mes.getMonth() + 1, 1); pintar(); };
$("#btn-hoy").onclick = () => { estado.mes = primerDiaMes(new Date()); estado.seleccion = hoyISO(); pintar(); };
$("#btn-nuevo").onclick = () => abrirFormulario(null, estado.seleccion);
$("#buscar").oninput = () => pintarClientes();

function pintar() {
  if (estado.pestana === "agenda") pintarAgenda();
  if (estado.pestana === "cobros") pintarCobros();
  if (estado.pestana === "clientes") pintarClientes();
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

function bloqueTotales(totales) {
  const monedas = Object.keys(totales);
  if (!monedas.length) return `<p class="vacio">Todavía no hay trabajos.</p>`;
  return monedas.map((m) => {
    const t = totales[m];
    return `<div class="moneda-titulo">${MONEDA[m].nombre}</div>
      <div class="cifras">
        <div class="cifra"><small>Ingresos</small><b style="color:var(--verde)">${dinero(t.ingresos, m)}</b></div>
        <div class="cifra"><small>Por cobrar</small><b style="color:var(--amarillo-texto)">${dinero(t.porCobrar, m)}</b></div>
        <div class="cifra"><small>Cobrado</small><b style="color:var(--azul)">${dinero(t.cobrado, m)}</b></div>
        <div class="cifra"><small>Agendado</small><b>${dinero(t.agendado, m)}</b></div>
      </div>`;
  }).join("");
}

function claseEstado(t) {
  if (t.estado === "NO_REALIZADO") return "ev-no";
  if (t.pagado) return "ev-pagado";
  if (t.estado === "REALIZADO") return "ev-realizado";
  return "ev-agendado";
}

function pintarAgenda() {
  const mes = estado.mes;
  const titulo = mes.toLocaleDateString("es-NI", { month: "long", year: "numeric" });
  $("#mes-titulo").textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  const cal = $("#calendario");
  cal.innerHTML = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => `<div class="cab">${d}</div>`).join("");
  const desfase = (mes.getDay() + 6) % 7;
  const inicio = new Date(mes.getFullYear(), mes.getMonth(), 1 - desfase);
  const diasMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
  const semanas = Math.ceil((desfase + diasMes) / 7);
  cal.style.gridTemplateRows = `auto repeat(${semanas}, minmax(0, 1fr))`;
  const hoy = hoyISO();
  const maxVisibles = 3;
  for (let i = 0; i < semanas * 7; i++) {
    const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    const s = iso(d);
    const delDia = estado.trabajos.filter((t) => t.fecha === s);
    const cobrosDia = estado.trabajos.filter((t) => cobroAbierto(t) && fechaCobro(t) === s);
    const celda = document.createElement("div");
    celda.className = "dia" + (d.getMonth() !== mes.getMonth() ? " fuera" : "") + (s === hoy ? " hoy" : "") + (s === estado.seleccion ? " sel" : "");
    celda.innerHTML = `<span class="num">${d.getDate()}</span>`;
    const items = [
      ...delDia.map((t) => ({ t, html: `${t.horaInicio != null ? `<b>${horaCorta(t.horaInicio)}</b> ` : ""}${esc(t.cliente)}`, clase: claseEstado(t) })),
      ...cobrosDia.map((t) => ({ t, html: `Cobrar a ${esc(t.cliente)}`, clase: "ev-cobro" })),
    ];
    items.slice(0, maxVisibles).forEach(({ t, html, clase }) => {
      const ev = document.createElement("div");
      ev.className = "evento " + clase;
      ev.innerHTML = html;
      ev.title = `${t.cliente} · ${t.titulo || MODALIDAD[t.modalidad]} · ${dinero(t.precio, t.moneda)}`;
      ev.onclick = (e) => { e.stopPropagation(); abrirFormulario(t); };
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
    bloqueTotales(totalesPorMoneda(delMes));

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
      <b>${dinero(saldo(t), t.moneda)}</b>${estado.sesion.soloLectura ? "" : '<button class="btn">Pagado</button>'}`;
    el.querySelector(".info").onclick = () => abrirFormulario(t);
    const btn = el.querySelector("button");
    if (btn) btn.onclick = () => guardar({ ...t, pagado: true });
    lista.appendChild(el);
  }
}

function pintarClientes() {
  $("#total-general").innerHTML = bloqueTotales(totalesPorMoneda(estado.trabajos));
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
  if (!precio || !form.fecha.value) { $("#form-saldo").textContent = ""; return; }
  const s = form.pagado.checked ? 0 : Math.max(0, precio - anticipo);
  $("#form-saldo").textContent = `Saldo por cobrar: ${dinero(s, form.moneda.value)} · Fecha de cobro: ${fechaLarga(sumarDias(form.fecha.value, DIAS_PARA_COBRO))}`;
}
form.addEventListener("input", actualizarSaldo);

$("#btn-cancelar").onclick = () => dlg.close();
$("#btn-borrar").onclick = async () => {
  if (editando && confirm("¿Borrar este trabajo? También se quitará de Google Calendar cuando se sincronice el celular.")) {
    await borrar(editando);
    dlg.close();
  }
};
form.onsubmit = async (e) => {
  e.preventDefault();
  if (estado.sesion.soloLectura) return;
  const precio = Number(form.precio.value || 0);
  const t = {
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
