// The compute course's three language models. They're dense transformers with the standard
// shapes of open models at these sizes, so their parameter counts, memory and arithmetic per
// token are realistic. The names are just their sizes.

export type ModelId = '8B' | '70B' | '400B';

export interface ModelConfig {
  id: ModelId;
  /** "8B model". */
  name: string;
  /** Width of the residual stream (hidden size). */
  d: number;
  /** Transformer layers. */
  layers: number;
  /** Attention heads (query heads). */
  heads: number;
  /** Key/value heads (grouped-query attention shares each among several query heads). */
  kvHeads: number;
  /** Width of the feed-forward (MLP) block's hidden layer. */
  ffn: number;
  /** Vocabulary size. */
  vocab: number;
}

export const MODELS: Record<ModelId, ModelConfig> = {
  '8B': { id: '8B', name: '8B model', d: 4096, layers: 32, heads: 32, kvHeads: 8, ffn: 14336, vocab: 128256 },
  '70B': { id: '70B', name: '70B model', d: 8192, layers: 80, heads: 64, kvHeads: 8, ffn: 28672, vocab: 128256 },
  '400B': { id: '400B', name: '400B model', d: 16384, layers: 126, heads: 128, kvHeads: 8, ffn: 53248, vocab: 128256 },
};

export const MODEL_IDS: ModelId[] = ['8B', '70B', '400B'];

/** Width of one attention head. */
export function headDim(m: ModelConfig): number {
  return m.d / m.heads;
}

/** Width of the keys (and of the values) kept per token per layer. */
export function kvDim(m: ModelConfig): number {
  return m.kvHeads * headDim(m);
}

/** Parameters in one layer's attention block: query and output projections, plus the smaller key and value projections. */
export function attentionParams(m: ModelConfig): number {
  return 2 * m.d * m.d + 2 * m.d * kvDim(m);
}

/** Parameters in one layer's feed-forward block (three matrices: gate, up and down). */
export function mlpParams(m: ModelConfig): number {
  return 3 * m.d * m.ffn;
}

export function layerParams(m: ModelConfig): number {
  return attentionParams(m) + mlpParams(m);
}

/** Input embedding plus output projection (untied). */
export function embeddingParams(m: ModelConfig): number {
  return 2 * m.vocab * m.d;
}

/** Total parameters. */
export function paramCount(m: ModelConfig): number {
  return m.layers * layerParams(m) + embeddingParams(m);
}

/**
 * Parameters a token's arithmetic actually passes through: every layer plus the output
 * projection (looking up the input embedding is a copy, not a multiplication).
 */
export function matmulParams(m: ModelConfig): number {
  return m.layers * layerParams(m) + m.vocab * m.d;
}

/** Bytes of key/value cache one token occupies across all layers, at the given bytes per number. */
export function kvBytesPerToken(m: ModelConfig, bytesPerValue = 2): number {
  return 2 * m.layers * kvDim(m) * bytesPerValue;
}

/**
 * Forward-pass FLOPs to process one token that attends to `context` earlier tokens:
 * two per weight it passes through (a multiply and an add), plus the attention scores and
 * weighted sum, which grow with the context.
 */
export function forwardFlopsPerToken(m: ModelConfig, context: number): number {
  return 2 * matmulParams(m) + 4 * m.layers * context * m.d;
}

/** Bytes per number for the precisions the course uses. */
export const BYTES: Record<'fp32' | 'bf16' | 'fp8', number> = { fp32: 4, bf16: 2, fp8: 1 };
