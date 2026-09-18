'use strict'

// The Whisper model Jarvis listens with.
//
// One, since 8 September 2026: the accurate one. The tiny and small models were
// offered beside it and are gone — the small one was the recommended default and
// still lost words the accurate one keeps, and a choice between "worse" and
// "what you want" is not a choice worth drawing a control for. See
// Docs/decisions/0026-one-listening-model.md.
//
// The shape stays a catalogue rather than collapsing into constants, because
// this is exactly the file a second model would come back to.
//
// Story 47: the size is stated before anything is downloaded. Guessing wrong
// here is worse than not saying — this is the size measured on this machine,
// for the weights Jarvis asks for: the encoder and the merged decoder, which
// are the two files the pipeline actually fetches.

/**
 * The precisions the app knows how to ask for, and the file name transformers.js
 * gives each. Both are eight bits and the files are the same size; they differ
 * in whether the range is signed. Anything else the hub publishes — fp16, q4,
 * uint8 — is a file this app does not fetch, so it is not named here and asking
 * for it fails loudly rather than downloading weights nothing will open.
 */
const PRECISIONS = Object.freeze({
  q8: '_quantized',
  int8: '_int8',
})

/** The two pieces the pipeline actually opens, in the order they are fetched. */
const PIECES = Object.freeze(['encoder_model', 'decoder_model_merged'])

const MODELS = Object.freeze({
  medium: {
    // Not `onnx-community/whisper-medium` — that repository does not exist, and
    // Hugging Face answers 401 rather than 404 for a name it does not have, so
    // the app reported an authorization problem for what was really a typo.
    // Found on 1 September 2026, by a user picking this option and getting
    // "Unauthorized access to file" instead of a download.
    id: 'onnx-community/whisper-medium-ONNX',
    label: 'Accurate',
    megabytes: 940,
    // Travels with the app, so a machine that has never run Jarvis hears the
    // first thing said to it. The second amendment to 0010 says what a model
    // that does not travel costs: a gigabyte that only lives while Jarvis is
    // open, with nothing kept when it stops.
    shipped: true,
    // The signed eight-bit decoder, asked for on 8 September 2026 to be heard
    // against the unsigned one. The encoder stays as it was, so what changes
    // between the two is one file. Same size, same speed to fetch; the question
    // is only whether it hears Portuguese better.
    quantization: { encoder_model: 'q8', decoder_model_merged: 'int8' },
    note: 'Good with technical terms. Expect to wait a few seconds after you stop speaking.',
  },
})

const DEFAULT = 'medium'

function model(name) {
  return MODELS[name] ?? MODELS[DEFAULT]
}

/** The precision asked of one piece, whether the model names one or names each. */
function precisionOf(quantization, piece) {
  return typeof quantization === 'string' ? quantization : quantization[piece]
}

/**
 * The two files this model's pipeline actually opens. Every one of these
 * repositories carries the same weights in half a dozen precisions, and the name
 * of the file follows the one asked for — so what is fetched and what is opened
 * are the same decision, made here once rather than in the script and the app
 * separately. A model whose files were chosen by hand would be downloaded and
 * then not found.
 */
function weights(name) {
  const { quantization } = model(name)
  return PIECES.map((piece) => {
    const precision = precisionOf(quantization, piece)
    const suffix = PRECISIONS[precision]
    if (suffix === undefined) throw new Error(`no file is published for ${precision} weights`)
    return `onnx/${piece}${suffix}.onnx`
  })
}

/** What the pipeline is told to load, in the shape transformers.js takes. */
function quantization(name) {
  return model(name).quantization
}

function names() {
  return Object.keys(MODELS)
}

/**
 * The models that travel in `Resources`, fetched by `npm run fetch-assets` and
 * read where they lie. Said here rather than in the script, so that the flag
 * which makes the Settings sheet say "already here" is the same flag that puts
 * the model there.
 */
function travelling() {
  return names().filter((name) => MODELS[name].shipped === true)
}

/** What the Panel says before fetching anything. */
function downloadNotice(name) {
  const chosen = model(name)
  return `The speech model has not been downloaded yet — about ${chosen.megabytes} MB. Jarvis needs it to hear you.`
}

module.exports = {
  MODELS,
  DEFAULT,
  PRECISIONS,
  PIECES,
  model,
  weights,
  quantization,
  names,
  travelling,
  downloadNotice,
}
