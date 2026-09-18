import { describe, expect, it } from 'vitest'
import {
  MODELS,
  DEFAULT,
  model,
  weights,
  quantization,
  names,
  travelling,
  downloadNotice,
} from '../src/main/models.js'

// Story 47: the size is stated before anything is downloaded. Guessing wrong is
// worse than not saying, so these numbers are measured, not estimated.

describe('the speech models on offer', () => {
  it('offers the accurate one and nothing else', () => {
    // The tiny and small models were removed on 8 September 2026. What is left
    // is one entry, and the default is it.
    expect(names()).toEqual(['medium'])
    expect(DEFAULT).toBe('medium')
    expect(MODELS[DEFAULT].label).toBe('Accurate')
  })

  it('states a size for every one of them', () => {
    for (const name of names()) {
      expect(MODELS[name].megabytes, name).toBeGreaterThan(0)
      expect(MODELS[name].note, name).toBeTruthy()
    }
  })

  it('falls back to the recommended one when asked for something else', () => {
    expect(model('enormous')).toBe(MODELS[DEFAULT])
    expect(model(undefined)).toBe(MODELS[DEFAULT])
  })

  it('says the size out loud before fetching anything', () => {
    expect(downloadNotice('medium')).toContain('940 MB')
  })

  it('travels, so a fresh machine hears the first thing said to it', () => {
    // The flag is not decoration: it is what `npm run fetch-assets` reads to
    // decide what to put in Resources, and what the Settings sheet reads to
    // decide whether to call a model a download.
    expect(travelling()).toEqual(['medium'])
  })

  it('falls back to the one model when asked for one that was removed', () => {
    expect(model('small')).toBe(MODELS.medium)
    expect(model('tiny')).toBe(MODELS.medium)
  })

  it('names the file for the precision each model asks for', () => {
    // The accurate one is being tried with the signed eight-bit decoder. What
    // matters here is that the file named follows the precision asked for: a
    // model fetched in one precision and opened in another is a download that
    // is never found.
    expect(quantization('medium')).toEqual({
      encoder_model: 'q8',
      decoder_model_merged: 'int8',
    })
    expect(weights('medium')).toEqual([
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_int8.onnx',
    ])
  })

  it('can name a file for every precision it offers', () => {
    // A model asking for a precision this file knows no file name for would be
    // fetched as nothing and then reported as somehow not there.
    for (const name of names()) {
      expect(() => weights(name), name).not.toThrow()
      expect(weights(name), name).toHaveLength(2)
    }
  })

  it('names a real published model for each choice', () => {
    for (const name of names()) {
      expect(MODELS[name].id, name).toMatch(/^onnx-community\/whisper-/)
    }
  })
})
