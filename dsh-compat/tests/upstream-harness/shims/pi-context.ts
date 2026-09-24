/**
 * lyteboat adaptation: upstream imports `toPiContext` from the pi-ai adapter's
 * source (`@deepseek-ai/dsh-llm-pi-ai/src/context.ts`), which the published
 * package does not ship. The admission spec only inspects the single system
 * prompt slot and the user-role message contents, so this stand-in derives
 * exactly those two facts from the harness request.
 */
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

interface PiContextView {
  systemPrompt: string | undefined
  messages: { role: string; content: unknown }[]
}

function textOf(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  return content
    .map(block => (block as { type: string; text?: string }).type === 'text' ? (block as { text: string }).text : '')
    .join('')
}

export function toPiContext(options: GenerateOptions): PiContextView {
  const [first, ...rest] = options.messages
  const leadingSystem = first !== undefined && first.role === 'system' ? first : undefined
  const remaining = leadingSystem === undefined ? options.messages : rest
  return {
    systemPrompt: leadingSystem === undefined ? undefined : String(textOf(leadingSystem.content)),
    messages: remaining.map(message => ({ role: message.role, content: textOf(message.content) })),
  }
}
