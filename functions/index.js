// Avisos push cuando cambia un trabajo de la agenda.
// Al guardar un trabajo nuevo o cambiado, avisa a los teléfonos registrados
// del dueño y de sus lectores (ej. ventas).
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

exports.avisarCambioTrabajo = onDocumentWritten(
  "users/{uid}/trabajos/{id}",
  async (event) => {
    const antes = event.data.before.exists ? event.data.before.data() : null;
    const despues = event.data.after.exists ? event.data.after.data() : null;
    if (!despues) return; // borrado: no avisamos por ahora

    // Ignora cambios que no son del usuario (ej. solo el campo "actualizado")
    const campos = ["titulo", "fecha", "horaInicio", "cliente", "precio", "anticipo", "pagado", "borrado"];
    const cambio = !antes || campos.some((c) => JSON.stringify(antes[c]) !== JSON.stringify(despues[c]));
    if (!cambio) return;

    const db = getFirestore();
    const { uid } = event.params;
    const tokensSnap = await db.collection("users").doc(uid).collection("tokens").get();
    const docs = tokensSnap.docs.filter((d) => d.get("token"));
    const tokens = docs.map((d) => d.get("token"));
    if (tokens.length === 0) return;

    const titulo = despues.titulo || "Trabajo";
    const mensaje = antes ? "Se actualizó un trabajo" : "Nuevo trabajo agendado";
    const resp = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: mensaje, body: `${titulo} · ${despues.fecha || ""}` },
      data: { trabajoId: event.params.id },
    });

    // Quita los tokens que ya no sirven (app desinstalada, etc.)
    const malos = [];
    resp.responses.forEach((r, i) => {
      if (!r.success && r.error && r.error.code === "messaging/registration-token-not-registered") malos.push(docs[i].ref);
    });
    await Promise.all(malos.map((ref) => ref.delete()));
  }
);
