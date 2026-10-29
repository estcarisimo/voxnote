/**
 * xAI (Grok) text clean-up behind the TextModelProvider interface. Endpoint
 * and parameters per the xAI REST reference and models page as read on
 * 2026-10-29 (docs.x.ai/developers/rest-api-reference/inference/responses,
 * docs.x.ai/docs/models): POST https://api.x.ai/v1/responses with a Bearer
 * key, `model`, `instructions`, `input`, `max_output_tokens` and `store`;
 * the answer is in `output[].content[]` items of type `output_text`.
 * `reasoning.effort` is not sent: its values "depend on the model" and are
 * not listed per model.
 */
import {
  assertSendable,
  buildCleanUpInput,
  CLEAN_UP_INSTRUCTIONS,
  describeParts,
  joinNatural,
  outputTokenLimit,
  readJson,
  responsesText,
  type TextModelInfo,
  type TextModelProvider,
} from './llm'

export const XAI_RESPONSES_ENDPOINT = 'https://api.x.ai/v1/responses'
export const XAI_HOST = 'api.x.ai'

/** Ids from the Text API pricing table; none is marked deprecated. */
export const XAI_TEXT_MODELS: readonly TextModelInfo[] = [
  { id: 'grok-4.7', label: 'grok-4.7 (most capable)' },
  { id: 'grok-4.6', label: 'grok-4.6' },
  {
    id: 'grok-4.20-0309-non-reasoning',
    label: 'grok-4.20-0309-non-reasoning (no reasoning)',
  },
]

export const DEFAULT_XAI_TEXT_MODEL = XAI_TEXT_MODELS[0].id

export function createXaiTextProvider(
  fetchImpl: typeof fetch = fetch,
): TextModelProvider {
  const name = 'xAI'
  return {
    id: 'xai',
    name,
    endpointHost: XAI_HOST,
    models: XAI_TEXT_MODELS,

    describeUpload(request, model) {
      return (
        `Sends ${joinNatural(describeParts(request))} to xAI at ${XAI_HOST}, ` +
        `model ${model}, with your API key, asking xAI not to store the request ` +
        `(store: false). Nothing else: not the recording, not the document, not other comments.`
      )
    },

    async cleanUp(request, options) {
      assertSendable(name, request, options)
      const response = await fetchImpl(XAI_RESPONSES_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          instructions: CLEAN_UP_INSTRUCTIONS,
          input: buildCleanUpInput(request),
          max_output_tokens: outputTokenLimit(request),
          store: false,
        }),
        signal: options.signal,
      })
      return responsesText(name, await readJson(name, response))
    },
  }
}
