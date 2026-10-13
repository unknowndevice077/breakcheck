import { Configuration, OpenAIApi } from 'openai'

const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY })
const openai = new OpenAIApi(configuration)

export async function complete(prompt: string): Promise<string> {
  const res = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
  })
  return res.data.choices[0]?.message?.content ?? ''
}

export async function embed(text: string): Promise<number[]> {
  const res = await openai.createEmbedding({ model: 'text-embedding-ada-002', input: text })
  return res.data.data[0]?.embedding ?? []
}

export async function legacy(prompt: string): Promise<string> {
  const res = await openai.createCompletion({ model: 'text-davinci-003', prompt })
  return res.data.choices[0]?.text ?? ''
}
