/**
 * OpenAI text generation behind the TextModelProvider interface. Endpoint and
 * parameters per the OpenAI Responses API reference and models page as read
 * on 2026-10-29 (developers.openai.com/api/reference/resources/responses/
 * methods/create, developers.openai.com/api/docs/models): POST /v1/responses
 * with `model`, `instructions`, `input`, `max_output_tokens`, `store` and
 * `reasoning.effort`; the answer is in `output[].content[]` items of type
 * `output_text`. `store: false` keeps OpenAI from storing the response for
 * later retrieval (the default is true).
 */
import {
  assertPromptSendable,
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

    describeDestination(model) {
      return (
        `to OpenAI at ${OPENAI_HOST}, model ${model}, with your API key, ` +
        'asking OpenAI not to store the response (store: false)'
      )
    },

    async generate(prompt, options) {
      assertPromptSendable(name, prompt, options)
      const response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          instructions: prompt.instructions,
          input: prompt.input,
          max_output_tokens: prompt.maxOutputTokens,
          // "low" and "medium" are listed for all four models.
          reasoning: { effort: prompt.effort },
          store: false,
        }),
        signal: options.signal,
      })
      return responsesText(name, await readJson(name, response))
    },
  }
}
