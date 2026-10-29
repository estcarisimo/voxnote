/**
 * OpenAI text clean-up behind the TextModelProvider interface. Endpoint and
 * parameters per the OpenAI Responses API reference and models page as read
 * on 2026-10-29 (developers.openai.com/api/reference/resources/responses/
 * methods/create, developers.openai.com/api/docs/models): POST /v1/responses
 * with `model`, `instructions`, `input`, `max_output_tokens`, `store` and
 * `reasoning.effort`; the answer is in `output[].content[]` items of type
 * `output_text`. `store: false` keeps OpenAI from storing the response for
 * later retrieval (the default is true).
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

export const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses'
export const OPENAI_HOST = 'api.openai.com'

/** The four flagship ids on the models page; none is marked deprecated. */
export const OPENAI_TEXT_MODELS: readonly TextModelInfo[] = [
  { id: 'gpt-6.1-terra', label: 'gpt-6.1-terra (fast, natural writing)' },
  { id: 'gpt-6-luna', label: 'gpt-6-luna (most efficient)' },
  { id: 'gpt-6.1-sol', label: 'gpt-6.1-sol' },
  { id: 'gpt-6-astra', label: 'gpt-6-astra (most capable)' },
]

export const DEFAULT_OPENAI_TEXT_MODEL = OPENAI_TEXT_MODELS[0].id

export function createOpenAiTextProvider(
  fetchImpl: typeof fetch = fetch,
): TextModelProvider {
  const name = 'OpenAI'
  return {
    id: 'openai',
    name,
    endpointHost: OPENAI_HOST,
    models: OPENAI_TEXT_MODELS,

    describeUpload(request, model) {
      return (
        `Sends ${joinNatural(describeParts(request))} to OpenAI at ${OPENAI_HOST}, ` +
        `model ${model}, with your API key, asking OpenAI not to store the response ` +
        `(store: false). Nothing else: not the recording, not the document, not other comments.`
      )
    },

    async cleanUp(request, options) {
      assertSendable(name, request, options)
      const response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
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
          // "low" is listed for all four models; a copy edit needs no more.
          reasoning: { effort: 'low' },
          store: false,
        }),
        signal: options.signal,
      })
      return responsesText(name, await readJson(name, response))
    },
  }
}
