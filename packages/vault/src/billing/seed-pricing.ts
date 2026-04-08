import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { pricing } from '../db/billing-schema.js';

/**
 * Default pricing per 1M tokens (in cents).
 * These are Byoky retail prices — set above wholesale cost to generate margin.
 * Wholesale cost varies by provider; these should be reviewed regularly.
 */
const DEFAULT_PRICING: Array<{
  providerId: string;
  modelPattern: string;
  inputPricePer1M: number;  // cents per 1M input tokens
  outputPricePer1M: number; // cents per 1M output tokens
}> = [
  // Anthropic
  { providerId: 'anthropic', modelPattern: 'claude-opus*',    inputPricePer1M: 1500, outputPricePer1M: 7500 },
  { providerId: 'anthropic', modelPattern: 'claude-sonnet*',  inputPricePer1M: 300,  outputPricePer1M: 1500 },
  { providerId: 'anthropic', modelPattern: 'claude-haiku*',   inputPricePer1M: 80,   outputPricePer1M: 400 },
  { providerId: 'anthropic', modelPattern: '*',               inputPricePer1M: 300,  outputPricePer1M: 1500 },

  // OpenAI
  { providerId: 'openai', modelPattern: 'gpt-4o',            inputPricePer1M: 250,  outputPricePer1M: 1000 },
  { providerId: 'openai', modelPattern: 'gpt-4o-mini',       inputPricePer1M: 15,   outputPricePer1M: 60 },
  { providerId: 'openai', modelPattern: 'gpt-4-turbo*',      inputPricePer1M: 1000, outputPricePer1M: 3000 },
  { providerId: 'openai', modelPattern: 'o1*',               inputPricePer1M: 1500, outputPricePer1M: 6000 },
  { providerId: 'openai', modelPattern: 'o3*',               inputPricePer1M: 1000, outputPricePer1M: 4000 },
  { providerId: 'openai', modelPattern: '*',                  inputPricePer1M: 250,  outputPricePer1M: 1000 },

  // Google Gemini
  { providerId: 'gemini', modelPattern: 'gemini-2*pro*',     inputPricePer1M: 125,  outputPricePer1M: 500 },
  { providerId: 'gemini', modelPattern: 'gemini-2*flash*',   inputPricePer1M: 10,   outputPricePer1M: 40 },
  { providerId: 'gemini', modelPattern: '*',                  inputPricePer1M: 50,   outputPricePer1M: 200 },

  // Mistral
  { providerId: 'mistral', modelPattern: 'mistral-large*',   inputPricePer1M: 200,  outputPricePer1M: 600 },
  { providerId: 'mistral', modelPattern: 'mistral-small*',   inputPricePer1M: 10,   outputPricePer1M: 30 },
  { providerId: 'mistral', modelPattern: '*',                 inputPricePer1M: 50,   outputPricePer1M: 150 },

  // Cohere
  { providerId: 'cohere', modelPattern: 'command-r-plus*',   inputPricePer1M: 250,  outputPricePer1M: 1000 },
  { providerId: 'cohere', modelPattern: 'command-r*',        inputPricePer1M: 15,   outputPricePer1M: 60 },
  { providerId: 'cohere', modelPattern: '*',                  inputPricePer1M: 50,   outputPricePer1M: 200 },

  // xAI (Grok)
  { providerId: 'xai', modelPattern: '*',                    inputPricePer1M: 500,  outputPricePer1M: 1500 },

  // DeepSeek
  { providerId: 'deepseek', modelPattern: 'deepseek-reasoner*', inputPricePer1M: 55, outputPricePer1M: 219 },
  { providerId: 'deepseek', modelPattern: '*',               inputPricePer1M: 27,   outputPricePer1M: 110 },

  // Groq
  { providerId: 'groq', modelPattern: '*',                   inputPricePer1M: 10,   outputPricePer1M: 10 },

  // Together
  { providerId: 'together', modelPattern: '*',               inputPricePer1M: 50,   outputPricePer1M: 150 },

  // Fireworks
  { providerId: 'fireworks', modelPattern: '*',              inputPricePer1M: 50,   outputPricePer1M: 150 },

  // Perplexity
  { providerId: 'perplexity', modelPattern: '*',             inputPricePer1M: 100,  outputPricePer1M: 300 },

  // OpenRouter (pass-through, approximate)
  { providerId: 'openrouter', modelPattern: '*',             inputPricePer1M: 200,  outputPricePer1M: 600 },
];

/**
 * Seed the pricing table with default values.
 * Skips rows where the (providerId, modelPattern) already exists.
 */
export async function seedPricing(): Promise<number> {
  const now = Date.now();
  let inserted = 0;

  for (const row of DEFAULT_PRICING) {
    try {
      await getDb().insert(pricing).values({
        id: crypto.randomUUID(),
        providerId: row.providerId,
        modelPattern: row.modelPattern,
        inputPricePer1M: row.inputPricePer1M,
        outputPricePer1M: row.outputPricePer1M,
        effectiveAt: now,
      }).onConflictDoNothing();
      inserted++;
    } catch {
      // Row may already exist
    }
  }

  return inserted;
}
