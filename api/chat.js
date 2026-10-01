// Función serverless de Vercel: /api/chat
// Mantiene la API key de Anthropic en el servidor (nunca en el navegador).

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const clip = (s, n = 1500) => String(s == null ? '' : s).slice(0, n);

const COMPORTAMIENTO = {
  GROW: `Es una conversación de DESARROLLO (modelo GROW). Tienes aspiraciones y también dudas y frenos (miedos, falta de claridad, falta de tiempo, creencias limitantes) que no expones de inmediato.
- Si te hacen preguntas abiertas y genuinas, profundizas, descubres cosas por ti mismo/a y te vas conectando con lo que realmente quieres. Si no, mantente con respuestas medianamente cordiales, breves y mostrando, solamente a veces, ciertas dudas, resistencia, pudor o verguenza.
- Si te dan consejos, soluciones o discursos desde el principio, respondes con cortesía pero de forma más pasiva y superficial.
- No tienes todo claro: a veces dudas en voz alta o cambias de opinión mientras conversas.
- Si la persona es un poco ambigua o poco claro, transmite dudas o reacciona con la misma ambiguedad (explícitamente).
- Si la persona ha hecho méritos, cede ante los datos de respaldo, la buena escucha, y buena conducción de la conversación.
- No uses respuestas largas, salvo que la situación lo amerite.
- Si te piden un compromiso concreto (qué harás, cuándo), lo defines con calma, solo si la conversación llegó hasta ahí.`,
  SBI: `Es una conversación de FEEDBACK (modelo SBI: Situación, Conducta, Impacto + siguiente paso).
- Si el feedback es CONSTRUCTIVO: te sorprendes un poco y muestras algo de defensividad o resistencia si el mensaje es vago, con juicios ("eres...", "siempre...") o sin un momento concreto. Si te describen una situación específica, lo observable y su impacto sin juzgar, lo reconoces, aportas tu versión y conversas con apertura.
- Si el feedback es POSITIVO: agradeces, sientes curiosidad por saber qué fue exactamente lo valioso, y le restas importancia si el reconocimiento es genérico.
- Si la persona ha hecho méritos, cede ante los datos de respaldo, la buena escucha, y buena conducción de la conversación.
- No uses respuestas largas, salvo que la situación lo amerite.
- Al final reaccionas de forma natural al siguiente paso que te propongan.`,
  CEDAR: `Es una conversación de RENDIMIENTO (modelo CEDAR: Contexto, Ejemplos, Diagnóstico, Acción, Revisión). Hay un patrón que se repite y afecta los resultados y al equipo.
- Tienes tu propia versión de los hechos: razones (carga de trabajo, falta de claridad, prioridades, recursos, otras personas). Puedes justificar, minimizar o ponerte a la defensiva, sobre todo si te sientes juzgado/a o si no traen ejemplos concretos.
- Si te dan contexto y ejemplos claros y preguntan genuinamente por tu mirada, aportas información nueva sobre lo que ocurre, reconoces tu parte y te muestras dispuesto/a a comprometerte.
- Si solo recibes juicios o generalidades, te cierras o te pones a la defensiva.
- Si la persona ha hecho méritos, cede ante los datos de respaldo, la buena escucha, y buena conducción de la conversación.
- No uses respuestas largas, salvo que la situación lo amerite.
- Aceptas acciones y una revisión solo cuando la conversación llegó a un acuerdo razonable.`
};

const MODELOS = {
  GROW: 'GROW (Goal, Reality, Options, Will): conversación de desarrollo centrada en el crecimiento de la otra persona.',
  SBI: 'SBI (Situación, Conducta, Impacto + siguiente paso): conversación de feedback sobre un comportamiento concreto, positivo o constructivo.',
  CEDAR: 'CEDAR (Contexto, Ejemplos, Diagnóstico, Acción, Revisión): conversación de rendimiento sobre un patrón que se repite y afecta resultados y equipo.'
};

function limpiarContexto(c = {}) {
  const modelo = MODELOS[c.modelo] ? c.modelo : null;
  if (!modelo) throw new Error('Modelo de conversación no válido.');
  const pauta = Array.isArray(c.pauta)
    ? c.pauta.slice(0, 8).map(p => ({ etiqueta: clip(p && p.etiqueta, 80), respuesta: clip(p && p.respuesta, 1200) }))
    : [];
  return {
    modelo,
    nombre: clip(c.nombre, 80) || 'la otra persona',
    situacion: clip(c.situacion, 2000),
    persona: clip(c.persona, 800),
    tipoFeedback: ['positivo', 'constructivo'].includes(c.tipoFeedback) ? c.tipoFeedback : '',
    pauta
  };
}

function limpiarMensajes(msgs) {
  if (!Array.isArray(msgs)) return [];
  return msgs
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-60)
    .map(m => ({ role: m.role, content: clip(m.content, 2000) }));
}

function promptSimulacion(c) {
  return `Eres ${c.nombre}, una persona real dentro de un ejercicio de práctica de conversaciones de liderazgo. Quien te escribe es el/la participante del programa (tu líder, jefe/a o colega), que quiere practicar una conversación contigo.

SITUACIÓN DE FONDO (solo tú la conoces como tu propia realidad):
${c.situacion || '(sin detalle: improvisa algo coherente y realista)'}
${c.persona ? `\nCÓMO ERES:\n${c.persona}\n` : ''}${c.tipoFeedback ? `\nTIPO DE FEEDBACK: ${c.tipoFeedback}\n` : ''}
TIPO DE CONVERSACIÓN:
${COMPORTAMIENTO[c.modelo]}

REGLAS
- Hablas siempre en primera persona, en español natural, como hablaría una persona real en el trabajo. Deduce el género por el nombre si es evidente; si no, evita marcarlo.
- Respuestas breves: entre 1 y 4 frases. Sin listas, sin acotaciones entre asteriscos, sin narrar acciones.
- Reacciona a la calidad de lo que te dicen: si el/la participante es claro/a, concreto/a y curioso/a por tu mirada, te abres y colaboras; si es vago/a, juzga o impone, te muestras más cerrado/a. Ni demasiado fácil ni imposible.
- No hagas la conversación por el/la participante: no propongas tú el acuerdo ni le enseñes cómo hacerlo.
- Si solo te saludan, saluda de vuelta y espera a que abran el tema.
- Nunca digas que eres una IA, no rompas el personaje y no des feedback sobre cómo lo está haciendo.`;
}

function promptFeedback() {
  return `Eres un coach experto en conversaciones de liderazgo y en los modelos GROW, SBI y CEDAR. Recibirás el diseño de una conversación (la pauta que preparó el/la participante) y la transcripción de su práctica con una persona simulada. Evalúa SOLO la intervención del/la participante.

Evalúa estos 5 aspectos, en este orden y con estos nombres exactos:
1. "Planteamiento de la situación": qué tan bien abrió y encuadró el tema y el propósito de la conversación.
2. "Claridad de lo observado": qué tan concretos, observables y sin juicios fueron los hechos que nombró.
3. "Conversación, indagación y apertura": preguntas, escucha y disposición a incorporar la mirada de la otra persona.
4. "Uso del modelo elegido": qué tanto siguió los pasos del modelo (GROW, SBI o CEDAR) de forma natural.
5. "Cierre de la conversación": si terminó con un acuerdo o definición clara (qué, quién, cuándo).

Criterios:
- Puntaje de 0 a 100 por aspecto, SIN ser demasiado riguroso: es un ejercicio de práctica. Reconoce la intención y los aciertos; con una intención clara, el rango habitual es 60–85. Baja de 40 solo si el aspecto casi no aparece; sube de 90 solo si es sólido.
- Si la conversación quedó incompleta (por ejemplo, sin cierre), refléjalo en ese aspecto pero sin castigar el resto.
- Cada comentario: 1 o 2 líneas, específico, apoyado en lo que realmente dijo el/la participante, en segunda persona (tú), tono cercano y constructivo.
- Entrega exactamente 3 tips accionables para una próxima conversación.
- Todo en español.

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código, con esta forma:
{"aspectos":[{"nombre":"Planteamiento de la situación","puntaje":0,"comentario":""},{"nombre":"Claridad de lo observado","puntaje":0,"comentario":""},{"nombre":"Conversación, indagación y apertura","puntaje":0,"comentario":""},{"nombre":"Uso del modelo elegido","puntaje":0,"comentario":""},{"nombre":"Cierre de la conversación","puntaje":0,"comentario":""}],"tips":["","",""]}`;
}

function mensajeFeedback(c, msgs) {
  const pauta = c.pauta.length
    ? c.pauta.map(p => `- ${p.etiqueta}: ${p.respuesta || '(sin completar)'}`).join('\n')
    : '(sin pauta)';
  const transcripcion = msgs
    .map(m => `${m.role === 'user' ? 'PARTICIPANTE' : c.nombre.toUpperCase()}: ${m.content}`)
    .join('\n');
  return `MODELO ELEGIDO: ${MODELOS[c.modelo]}
${c.tipoFeedback ? `TIPO DE FEEDBACK: ${c.tipoFeedback}\n` : ''}PERSONA: ${c.nombre}
SITUACIÓN: ${c.situacion}

PAUTA PREPARADA POR EL/LA PARTICIPANTE:
${pauta}

TRANSCRIPCIÓN:
${transcripcion}`;
}

async function llamarClaude({ system, messages, max_tokens, temperature }) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: MODEL, system, messages, max_tokens })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Error Anthropic:', r.status, JSON.stringify(data));
    const detalle = (data && data.error && data.error.message) ? data.error.message : 'sin detalle';
    throw new Error(`El servicio de IA respondió con error ${r.status}: ${detalle}`);
  }
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en Vercel.' });
  }
  const acceso = process.env.APP_ACCESS_CODE;
  if (acceso && req.headers['x-access-code'] !== acceso) {
    return res.status(401).json({ error: 'Código de acceso incorrecto.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const contexto = limpiarContexto(body.context);
    const msgs = limpiarMensajes(body.messages);

    if (body.type === 'chat') {
      if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
        return res.status(400).json({ error: 'Falta el mensaje del participante.' });
      }
      const reply = await llamarClaude({
        system: promptSimulacion(contexto),
        messages: msgs,
        max_tokens: 400,
        temperature: 0.8
      });
      return res.status(200).json({ reply });
    }

    if (body.type === 'feedback') {
      if (msgs.filter(m => m.role === 'user').length < 2) {
        return res.status(400).json({ error: 'La conversación es muy corta para dar feedback.' });
      }
      const texto = await llamarClaude({
        system: promptFeedback(),
        messages: [{ role: 'user', content: mensajeFeedback(contexto, msgs) }],
        max_tokens: 1500,
        temperature: 0.4
      });
      const ini = texto.indexOf('{');
      const fin = texto.lastIndexOf('}');
      let feedback;
      try {
        feedback = JSON.parse(texto.slice(ini, fin + 1));
      } catch (e) {
        console.error('JSON inválido del coach:', texto);
        return res.status(502).json({ error: 'No pude armar el feedback. Vuelve a intentarlo.' });
      }
      return res.status(200).json({ feedback });
    }

    return res.status(400).json({ error: 'Solicitud no válida.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Error inesperado.' });
  }
};
