import { useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  niceTicks,
  scale,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { forwardPass, type OpKind, type PassSummary } from '../../../engines/compute/transformer';
import { memoryPlan } from '../../../engines/compute/inference';
import { STATE_BYTES } from '../../../engines/compute/training';
import { ACCELERATORS } from '../../../model/compute/hardware';
import { MODELS, kvBytesPerToken, kvDim, matmulParams, paramCount, type ModelId } from '../../../model/compute/models';

// ---------------------------------------------------------------------------
// The model: one layer of the 8B model on one A-class, with some number of tokens passing through
// together and some earlier text already in the key/value cache.

const GPU = ACCELERATORS.A;
const M8 = MODELS['8B'];

/** Slider steps per doubling of the tokens processed together. */
export const TOKEN_STEPS = 32;
/** Tokens slider: 1 to 4,096. */
export const TOKEN_MAX_K = 12 * TOKEN_STEPS;
/** Earlier-text slider: 0, then 1 to 32,768 in eighths of a doubling. */
export const EARLIER_MAX_K = 120;

export function tokensAt(k: number): number {
  return Math.max(1, Math.round(2 ** (k / TOKEN_STEPS)));
}

export function earlierAt(k: number): number {
  return k <= 0 ? 0 : Math.round(2 ** (k / 8));
}

/** One token at a time, with 1,024 tokens of earlier text. */
export const EXPLORER_DEFAULTS = { tk: 0, ek: 80 };

export interface Explored {
  tokens: number;
  earlier: number;
  /** Tokens each new token can attend to: the earlier text plus those being processed. */
  context: number;
  pass: PassSummary;
}

export function explore(tk: number, ek: number): Explored {
  const tokens = tokensAt(tk);
  const earlier = earlierAt(ek);
  const context = earlier + tokens;
  return { tokens, earlier, context, pass: forwardPass(M8, tokens, context, GPU) };
}

const FF_IDS = ['up', 'act', 'down'];

/** Both feed-forward matrix multiplies are limited by arithmetic rather than memory. */
export function feedForwardComputeBound(p: PassSummary): boolean {
  return p.ops.filter((o) => o.id === 'up' || o.id === 'down').every((o) => o.bound === 'compute');
}

/** Time of the attention operation, and of the whole feed-forward block, s. */
export function attentionVsFeedForward(p: PassSummary): { attention: number; feedForward: number } {
  const attention = p.ops.find((o) => o.id === 'attn')!.totalS;
  const feedForward = p.ops.filter((o) => FF_IDS.includes(o.id)).reduce((s, o) => s + o.totalS, 0);
  return { attention, feedForward };
}

/** Attention takes longer than the whole feed-forward block. */
export function attentionSolved(tk: number, ek: number): boolean {
  const a = attentionVsFeedForward(explore(tk, ek).pass);
  return a.attention > a.feedForward;
}

/** FLOPs attention does in each layer, per new token, for every token of context: a multiply and an add per number of the query, and again per number of the value. */
export const ATTENTION_FLOPS_PER_CONTEXT = 4 * M8.d;
/** FLOPs the feed-forward block does per token: a multiply and an add per weight. */
export const FEED_FORWARD_FLOPS = 2 * 3 * M8.d * M8.ffn;
/** Context at which attention's arithmetic equals the feed-forward block's. */
export const BALANCE_CONTEXT = FEED_FORWARD_FLOPS / ATTENTION_FLOPS_PER_CONTEXT;

/** Challenge b reads a document in chunks of this many tokens (slider position). */
export const CHUNK_K = 10 * TOKEN_STEPS;

/** Challenge b: a 1,024-token chunk with the least earlier text at which attention takes longer than the feed-forward block. */
export function chunkSolved(tk: number, ek: number): boolean {
  return tk === CHUNK_K && ek > 0 && attentionSolved(tk, ek) && !attentionSolved(tk, ek - 1);
}

// ---------------------------------------------------------------------------
// What a running model keeps in memory on one A-class.

/** Conversation-length slider: 256 to 32,768 tokens in quarters of a doubling. */
export const LENGTH_MIN_K = 32;
export const LENGTH_MAX_K = 60;
export function lengthAt(k: number): number {
  return Math.round(2 ** (k / 4));
}

export const MEMORY_DEFAULTS = { model: '8B' as ModelId, convs: 16, lk: 48 };

export function memoryUse(model: ModelId, convs: number, length: number) {
  const m = MODELS[model];
  const weights = paramCount(m) * 2;
  const perToken = kvBytesPerToken(m);
  const cache = convs * length * perToken;
  const plan = memoryPlan({ model, gpu: 'A', tp: 1, precision: 'bf16' });
  const capacity = GPU.memoryGB * 1e9;
  return { weights, perToken, cache, total: weights + cache, usable: plan.usableBytes, capacity, fits: weights + cache <= plan.usableBytes, kvTokens: plan.kvTokens };
}

/** The memory challenge's conversation length, tokens. */
export const CHALLENGE_LENGTH = 8192;

/** Most conversations of `length` tokens whose cache fits beside the model's weights on one A-class. */
export function mostConversations(model: ModelId, length: number): number {
  return Math.floor(memoryUse(model, 0, length).kvTokens / length);
}

/** Challenge c: the 8B model holding as many 8,192-token conversations as one A-class has room for. */
export function memorySolved(s: { model: ModelId; convs: number; lk: number }): boolean {
  const length = lengthAt(s.lk);
  return s.model === '8B' && length === CHALLENGE_LENGTH && memoryUse(s.model, s.convs, length).fits && s.convs === mostConversations('8B', CHALLENGE_LENGTH);
}

// ---------------------------------------------------------------------------
// Formatting.

export function us(seconds: number): string {
  const v = seconds * 1e6;
  if (v >= 1000) return `${fmt(v / 1000, v >= 10000 ? 1 : 2)} ms`;
  return `${fmt(v, v >= 100 ? 0 : v >= 10 ? 1 : 2)} µs`;
}

export function ms(seconds: number): string {
  const v = seconds * 1e3;
  return `${fmt(v, v >= 100 ? 0 : v >= 10 ? 1 : 2)} ms`;
}

export function gflop(flops: number): string {
  const v = flops / 1e9;
  if (v >= 1000) return `${fmt(v / 1000, 2)} TFLOP`;
  return `${fmt(v, v >= 100 ? 0 : v >= 10 ? 1 : 2)} GFLOP`;
}

export function bytesText(b: number): string {
  if (b >= 1e9) return `${fmt(b / 1e9, b >= 100e9 ? 0 : 1)} GB`;
  if (b >= 1e6) return `${fmt(b / 1e6, b >= 100e6 ? 0 : 1)} MB`;
  return `${fmt(b / 1e3)} kB`;
}

const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function pctText(x: number): string {
  return `${fmt(x * 100, x < 0.1 && x > 0 ? 1 : 0)}%`;
}

// ---------------------------------------------------------------------------
// The layer figure: each operation's arithmetic time and data-movement time, side by side.

const SHORT: Record<string, string> = {
  norm1: 'Normalize',
  qkv: 'Query, key, value',
  attn: 'Attention (reads cache)',
  out: 'Output projection',
  norm2: 'Normalize, add',
  up: 'Feed-forward up',
  act: 'Activation',
  down: 'Feed-forward down',
};

const KIND_FILL: Record<OpKind, string> = { matmul: tint(GRAPHIC.orange, 0.22), attention: tint(GRAPHIC.teal, 0.22), elementwise: '#eeeeeb' };
const KIND_LABEL: Record<OpKind, string> = { matmul: 'matrix multiply', attention: 'attention', elementwise: 'elementwise step' };

const ROW = 40;
const TOP = 26;
const BOX_X = 8;
const BOX_W = 180;
const BAR_X0 = 200;
const BAR_X1 = 548;

/** The operation the highlight is on at `phase` (0–1): it lingers on each for its share of the layer's time. */
export function activeOp(p: PassSummary, phase: number): number {
  let acc = 0;
  for (let i = 0; i < p.ops.length; i++) {
    acc += p.ops[i].totalS / p.layerS;
    if (phase < acc) return i;
  }
  return p.ops.length - 1;
}

function LayerChart({ e, playing }: { e: Explored; playing: boolean }) {
  const [phase, setPhase] = useState(0);
  useAnimationFrame((dt) => setPhase((p) => (p + dt / 4) % 1), playing);
  const active = activeOp(e.pass, phase);
  const ops = e.pass.ops;
  const maxS = Math.max(...ops.map((o) => Math.max(o.computeS, o.memoryS)));
  const w = (s: number) => Math.max(1, (s / maxS) * (BAR_X1 - BAR_X0));
  const height = TOP + ops.length * ROW + 34;
  const memOps = ops.filter((o) => o.bound === 'memory').map((o) => SHORT[o.id].toLowerCase());
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${height}`}
      role="img"
      aria-label={`One layer of the 8B model on an A-class, ${fmt(e.tokens)} token${e.tokens === 1 ? '' : 's'} at a time with ${fmt(e.context)} tokens of context: ${us(e.pass.layerS)} per layer, ${pctText(e.pass.memoryBoundShare)} of it limited by memory. ${
        memOps.length === ops.length ? 'Every operation waits on memory.' : memOps.length ? `Memory-bound: ${memOps.join(', ')}.` : 'Every operation is limited by arithmetic.'
      }`}
    >
      <text className="ax" x={BOX_X} y={14}>
        One layer, top to bottom
      </text>
      <text className="ax" x={BAR_X0} y={14}>
        Time each operation needs for its arithmetic and for its data
      </text>
      <line x1={BOX_X + BOX_W / 2} x2={BOX_X + BOX_W / 2} y1={TOP} y2={TOP + ops.length * ROW - 8} stroke="#cfcfcb" strokeWidth={2} />
      {ops.map((o, i) => {
        const y = TOP + i * ROW;
        const memBound = o.bound === 'memory';
        const on = i === active;
        return (
          <g key={o.id}>
            {on && <rect x={0} y={y - 4} width={640} height={ROW - 2} fill="#f2f2ee" />}
            <rect x={BOX_X} y={y} width={BOX_W} height={ROW - 12} rx={4} fill={KIND_FILL[o.kind]} stroke={on ? '#333' : '#c9c9c4'} strokeWidth={on ? 1.5 : 1} />
            <text x={BOX_X + 10} y={y + 18} style={{ fontSize: 12.5, fontWeight: on ? 600 : 500, fill: '#333' }}>
              {SHORT[o.id]}
            </text>
            <rect x={BAR_X0} y={y + 2} width={w(o.computeS)} height={10} fill={memBound ? tint(GRAPHIC.orange, 0.45) : GRAPHIC.orange} />
            <rect x={BAR_X0} y={y + 15} width={w(o.memoryS)} height={10} fill={memBound ? GRAPHIC.violet : tint(GRAPHIC.violet, 0.45)} />
            <text x={632} y={y + 11} textAnchor="end" style={{ fontSize: 12.5, fontWeight: 500, fill: TEXT.teal }}>
              {us(o.totalS)}
            </text>
            <text x={632} y={y + 25} textAnchor="end" className="ax" style={{ fill: memBound ? TEXT.violet : TEXT.orange }}>
              {memBound ? 'memory' : 'arithmetic'}
            </text>
          </g>
        );
      })}
      <line className="base" x1={BAR_X0} x2={BAR_X0} y1={TOP - 2} y2={TOP + ops.length * ROW - 10} />
      <text className="ax" x={BOX_X} y={height - 10}>
        {`${fmt(M8.layers)} such layers, then the vocabulary projection`}
      </text>
      <text className="ax ax-e" x={632} y={height - 10}>
        {`layer ${us(e.pass.layerS)} · model ${ms(e.pass.totalS)}`}
      </text>
    </svg>
  );
}

function explorerCaption(e: Explored): string {
  const p = e.pass;
  const { attention, feedForward } = attentionVsFeedForward(p);
  const ff = p.ops.filter((o) => FF_IDS.includes(o.id));
  const ffBytes = ff.reduce((s, o) => s + o.weightBytes, 0);
  const ffFlops = ff.reduce((s, o) => s + o.flops, 0);
  if (p.memoryBoundShare >= 0.999)
    return `Every operation waits on memory. The feed-forward block alone reads ${bytesText(ffBytes)} of weights to do ${gflop(ffFlops)} of arithmetic${
      attention > 0.25 * feedForward ? `, and attention reads ${bytesText(p.ops.find((o) => o.id === 'attn')!.kvBytes)} of cached keys and values` : ''
    }.`;
  if (attention > feedForward) return `Attention, ${us(attention)}, now takes longer than the whole feed-forward block, ${us(feedForward)}: its arithmetic grows with every token of context.`;
  if (!feedForwardComputeBound(p)) return `${fmt(e.tokens)} tokens share each pass over the weights, but the feed-forward multiplies still wait on memory.`;
  return `The matrix multiplies are limited by arithmetic now; only the small elementwise steps still wait on memory, ${pctText(p.memoryBoundShare)} of the layer’s time.`;
}

// ---------------------------------------------------------------------------
// The memory figure.

function MemoryChart({ u, model, convs, length }: { u: ReturnType<typeof memoryUse>; model: ModelId; convs: number; length: number }) {
  const max = Math.max(100e9, u.total * 1.08);
  const x = scale(0, max, 30, 610);
  const ticks = niceTicks(0, max / 1e9, 5);
  const over = !u.fits;
  const wW = x(u.weights) - x(0);
  const cW = x(u.total) - x(u.weights);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 150"
      role="img"
      aria-label={`The ${model} model’s weights, ${bytesText(u.weights)}, and the key/value cache for ${fmt(convs)} conversations of ${fmt(length)} tokens, ${bytesText(u.cache)}: ${bytesText(
        u.total,
      )} in all, against one A-class’s 80 GB. ${over ? 'It doesn’t fit.' : 'It fits.'}`}
    >
      <text className="ax" x={30} y={14}>
        Memory a running model needs
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line className="gl" x1={x(t * 1e9)} x2={x(t * 1e9)} y1={36} y2={98} />
          <text className="ax ax-m" x={x(t * 1e9)} y={116}>
            {t === 0 ? '0' : `${fmt(t)} GB`}
          </text>
        </g>
      ))}
      <rect x={x(0)} y={48} width={wW} height={38} fill={GRAPHIC.violet} />
      <rect x={x(u.weights)} y={48} width={Math.max(0, cW)} height={38} fill={tint(GRAPHIC.violet, 0.4)} />
      {wW > 64 && (
        <text x={x(0) + 8} y={71} style={{ fontSize: 12.5, fontWeight: 500, fill: '#fff' }}>
          weights
        </text>
      )}
      {cW > 54 && (
        <text x={x(u.weights) + 8} y={71} style={{ fontSize: 12.5, fontWeight: 500, fill: TEXT.violet }}>
          cache
        </text>
      )}
      <line x1={x(u.usable)} x2={x(u.usable)} y1={36} y2={98} stroke="#777" strokeWidth={1.2} strokeDasharray="4 3" />
      <line x1={x(u.capacity)} x2={x(u.capacity)} y1={30} y2={98} stroke={GRAPHIC.red} strokeWidth={2} />
      <text x={x(u.capacity) + 5} y={32} style={{ fontSize: 12, fontWeight: 500, fill: TEXT.red }}>
        one A-class: 80 GB
      </text>
      <text className="ax ax-e" x={x(u.usable) - 5} y={110 + 24}>
        {`usable for weights and cache: ${fmt(u.usable / 1e9)} GB`}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s = useScenario('layer', EXPLORER_DEFAULTS);
  const { tk, ek } = s.state;
  const e = useMemo(() => explore(tk, ek), [tk, ek]);
  const solvedB = useMemo(() => chunkSolved(tk, ek), [tk, ek]);
  const av = attentionVsFeedForward(e.pass);

  const play = usePlay(true);

  const mem = useScenario('memory', MEMORY_DEFAULTS);
  const { model, convs, lk } = mem.state;
  const length = lengthAt(lk);
  const u = memoryUse(model, convs, length);
  const solvedC = memorySolved(mem.state);

  // Numbers for the prose.
  const decode = explore(EXPLORER_DEFAULTS.tk, EXPLORER_DEFAULTS.ek);
  const prompt = explore(10 * TOKEN_STEPS, 0);
  const longDecode = explore(0, EARLIER_MAX_K);
  const longAv = attentionVsFeedForward(longDecode.pass);
  const decodeOps = Object.fromEntries(decode.pass.ops.map((o) => [o.id, o]));
  const ffWeights = ['up', 'down'].reduce((acc, id) => acc + decodeOps[id].weightBytes, 0);
  const layerWeights = decode.pass.ops.reduce((acc, o) => acc + o.weightBytes, 0);
  const weightsPerToken = matmulParams(M8) * 2;
  const decodeTflops = decode.pass.totalFlops / decode.pass.totalS / 1e12;
  const u8Convs = 64;
  const u8Length = 4096;
  const u8 = memoryUse('8B', u8Convs, u8Length);
  const u70 = memoryUse('70B', 0, 4096);
  const room4k = mostConversations('8B', 4096);
  const roomChallenge = mostConversations('8B', CHALLENGE_LENGTH);
  /** Training keeps this many times the bytes per weight that serving in BF16 does (Lesson 3.3). */
  const trainStateRatio = (STATE_BYTES.replicated + STATE_BYTES.shardable) / 2;

  const statusC =
    model !== '8B'
      ? 'Choose the 8B model.'
      : length !== CHALLENGE_LENGTH
        ? `Each conversation is ${fmt(length)} tokens. Set it to ${fmt(CHALLENGE_LENGTH)}.`
        : !u.fits
          ? `${fmt(convs)} conversations of ${fmt(length)} tokens need ${bytesText(u.total)} with the weights: more than the ${fmt(u.usable / 1e9)} GB usable.`
          : `${fmt(convs)} conversation${convs === 1 ? '' : 's'} of ${fmt(length)} tokens fit, using ${bytesText(u.total)} of the ${fmt(u.usable / 1e9)} GB usable. Is that the most?`;
  const chunk = tokensAt(CHUNK_K);
  const actS = e.pass.ops.find((o) => o.id === 'act')!.totalS;
  const statusB =
    tk !== CHUNK_K
      ? `Set the tokens processed together to ${fmt(chunk)}; ${fmt(e.tokens)} now.`
      : av.attention > av.feedForward
        ? `Attention takes longer, ${us(av.attention)} against ${us(av.feedForward)}. Is ${fmt(e.earlier)} tokens the least earlier text that does it?`
        : `With ${fmt(e.earlier)} tokens of earlier text, attention takes ${us(av.attention)} and the feed-forward block ${us(av.feedForward)}.`;

  return (
    <LessonPage id="compute/3.1">
      <P>
        Chapter 2 measured what a GPU can do: how many lanes it has, how fast it can be fed, and how quickly it can trade results with its neighbors. This chapter
        turns to the work. Much of today’s demand for data-center GPUs comes from training and running neural networks, and language models above all, so that is
        the work we’ll follow. Before we can say why one job needs a different kind of GPU-hour from another, we need to see what a model actually asks of the chip.
      </P>
      <P>
        A language model reads and writes text as <b>tokens</b>: words, or pieces of words a few characters long. Each token becomes a vector of numbers — 4,096 of
        them in the course’s 8B model, the model’s width — and the vectors pass through a stack of identical <b>layers</b>, {M8.layers} in the 8B model. In each
        layer, a step called <K tone="teal">attention</K> lets every token gather information from the tokens before it, and a <b>feed-forward</b> block then
        transforms each token’s vector on its own. Both are built from matrix multiplications, and the matrices are the model’s <b>weights</b>: {fmt(paramCount(M8) / 1e9, 2)}{' '}
        billion numbers in all, learned in training. After the last layer, one more multiplication turns each vector into a score for every one of the{' '}
        {fmt(M8.vocab)} tokens the model knows, and the highest-scoring one is, roughly, the model’s choice of what comes next.
      </P>
      <P>
        Writing a reply means one full pass through every layer for each new token. The new token joins the text, and the next pass makes the one after it. To avoid
        recomputing the earlier tokens on every pass, each layer keeps what attention needs from them, their <b>keys</b> and <b>values</b>, in a{' '}
        <K tone="violet">key/value cache</K>. Reading a prompt is different: all its tokens are known at once, so they can pass through the layers together.
      </P>
      <P>
        In the next demonstration, one layer of the 8B model runs on an A-class 80 GB. Its eight operations run top to bottom. Attention is three of them: a
        matrix multiply that turns each token’s vector into a <b>query</b> (what it looks for) and the key and value it offers later tokens, the attention step
        itself, and an output projection, another matrix multiply that maps the result back into the token’s vector. The small elementwise steps around them
        rescale each vector (“normalize”), add each block’s result back into it, and apply the activation function, a fixed curve, to every number between the
        feed-forward block’s two multiplies. Beside each operation, two bars on one scale show the time its <K tone="orange">arithmetic</K> would
        take at the A-class’s {fmt(GPU.bf16Tflops)} TFLOPS and the time its <K tone="violet">data</K> — weights, <K>activations</K> (the vectors passing from
        one operation to the next) and cached keys and values — would take to move at {GPU.bandwidthTBs} TB/s. As in <a href={lessonHref('compute/2.4')}>Lesson 2.4</a>,
        the longer bar sets the operation’s time, and the highlight lingers on each operation for its share of the layer’s time. Set how many tokens pass through
        together and how much earlier text is already in the cache:
      </P>

      <Figure name="Neural Network Execution Explorer" scenario={s} play={play}>
        <LayerChart e={e} playing={play.playing} />
        <Legend
          items={[
            { label: 'arithmetic time', color: GRAPHIC.orange },
            { label: 'data-movement time', color: GRAPHIC.violet },
            { label: KIND_LABEL.matmul, color: KIND_FILL.matmul },
            { label: KIND_LABEL.attention, color: KIND_FILL.attention },
            { label: KIND_LABEL.elementwise, color: KIND_FILL.elementwise },
          ]}
        />
        <Readouts
          items={[
            { label: 'arithmetic per layer', value: gflop(e.pass.layerFlops), tone: 'orange' },
            { label: 'data moved per layer', value: bytesText(e.pass.layerBytes), tone: 'violet' },
            { label: 'arithmetic multiplying by weights', value: pctText(e.pass.matmulShare) },
            { label: 'time waiting on memory', value: pctText(e.pass.memoryBoundShare), tone: 'violet' },
          ]}
        />
        <Slider
          label="Tokens processed together"
          tone="orange"
          value={tk}
          min={0}
          max={TOKEN_MAX_K}
          onChange={(v) => s.set({ tk: v })}
          display={`${fmt(e.tokens)} token${e.tokens === 1 ? '' : 's'}`}
        />
        <Slider
          label="Earlier text in the cache"
          tone="violet"
          value={ek}
          min={0}
          max={EARLIER_MAX_K}
          onChange={(v) => s.set({ ek: v })}
          display={`${fmt(e.earlier)} tokens`}
        />
        <Caption>{explorerCaption(e)}</Caption>
      </Figure>

      <P>
        It starts by writing one token with {fmt(decode.earlier)} tokens of text before it. Every operation is limited by memory, and the arithmetic bars barely
        show. The layer has to read {bytesText(layerWeights)} of weights to do {gflop(decode.pass.layerFlops)} of arithmetic: each two-byte weight is used for one
        multiply and one add, the matrix-times-one-vector of <a href={lessonHref('compute/2.3')}>Lesson 2.3</a>. The two feed-forward multiplies alone read{' '}
        {bytesText(ffWeights)} and take {fmt((decodeOps.up.totalS + decodeOps.down.totalS) / decode.pass.layerS * 100)}% of the layer’s {us(decode.pass.layerS)}. Across{' '}
        {M8.layers} layers and the vocabulary projection, every new token means reading {bytesText(weightsPerToken)} of weights — all of them except the table
        that gives each token its first vector, which is looked up a row at a time rather than read whole — and the pass takes{' '}
        {ms(decode.pass.totalS)}. One conversation could get about {fmt(1 / decode.pass.totalS)} tokens a second this way — even in this idealized model, where
        every operation runs exactly at its roofline — while the A-class’s arithmetic runs at {fmt(decodeTflops, 1)} TFLOPS, about a third of one percent of its peak.
      </P>
      <P>
        Now read a prompt instead: take the earlier text to 0 and the tokens to {fmt(prompt.tokens)}. A single pass carries all {fmt(prompt.tokens)} tokens through
        each layer, so every weight read from memory is used {fmt(prompt.tokens)} times — well past the few hundred vectors at which, as{' '}
        <a href={lessonHref('compute/2.4')}>Lesson 2.4</a> found, a matrix multiply stops waiting on memory. The matrix multiplies are now limited by arithmetic, the whole model takes{' '}
        {ms(prompt.pass.totalS)} — {fmt(prompt.pass.totalS / decode.pass.totalS, 1)} times as long as one token, for {fmt(prompt.tokens)} times the tokens — and
        only the small elementwise steps still wait on memory, {pctText(prompt.pass.memoryBoundShare)} of the time. In both cases, multiplying by the weights accounts
        for about {fmt(Math.round(decode.pass.matmulShare * 100))}% of the arithmetic. The same model on the same chip is two different workloads: reading is
        compute-bound and writing is memory-bound.
      </P>

      <H2>Attention and the length of the text</H2>
      <P>
        Every operation in the layer except one does the same work for a token however much text came before it. Attention is the exception. To decide what to take
        from earlier tokens, each new token compares itself with every one of them and then forms a weighted sum of their values, so its arithmetic grows with the
        length of the context, and so does the cache it must read: the 8B model keeps {fmt(kvBytesPerToken(M8))} bytes of keys and values for every token — two
        vectors of {fmt(kvDim(M8))} numbers in each of {M8.layers} layers, at two bytes each. Comparing a new token with one token of context takes a multiply and
        an add for each of the {fmt(M8.d)} numbers of its query, and adding in that token’s value as many again: {fmt(ATTENTION_FLOPS_PER_CONTEXT)} FLOPs in each
        layer for every token of context. The feed-forward block’s arithmetic is fixed: in each layer, a multiply and an add for each of its{' '}
        {fmt(FEED_FORWARD_FLOPS / 2e6)} million weights, {fmt(FEED_FORWARD_FLOPS / 1e6)} million FLOPs a token.
      </P>
      <P>
        Take the earlier text in <FigRef to="Neural Network Execution Explorer">the demonstration</FigRef> all the way to {fmt(longDecode.earlier)} tokens while
        writing one token at a time. Attention now reads {bytesText(longDecode.pass.ops.find((o) => o.id === 'attn')!.kvBytes)} of cache per layer and takes{' '}
        {us(longAv.attention)}, but the feed-forward block, reading its weights, still takes {us(longAv.feedForward)}. Both are waiting on memory, and the weights are
        still the bigger read. Attention overtakes only when its arithmetic grows large too: when many tokens are processed together, as when a long document is
        read {fmt(chunk)} tokens at a time. Then both are limited by arithmetic, and it comes down to the two counts of FLOPs.
      </P>

      <Challenge
        id="b"
        question={`Predict first: at ${fmt(ATTENTION_FLOPS_PER_CONTEXT)} FLOPs per token of context against the feed-forward block’s ${fmt(FEED_FORWARD_FLOPS / 1e6)} million, how much context makes the two equal? Then check: with ${fmt(chunk)} tokens processed together, find the least earlier text at which attention takes longer than the whole feed-forward block.`}
        solved={solvedB}
        status={statusB}
        success={`Solved: ${fmt(e.earlier)} tokens of earlier text, ${fmt(e.context)} tokens of context counting the chunk itself. The arithmetic alone balances at ${fmt(
          FEED_FORWARD_FLOPS / 1e6,
        )} million ÷ ${fmt(ATTENTION_FLOPS_PER_CONTEXT)} ≈ ${fmt(BALANCE_CONTEXT)} tokens of context; the feed-forward block’s activation step also waits ${us(
          actS,
        )} on memory, so attention needs a little more to overtake it. Past that point attention is the biggest operation in the layer, and it keeps growing with the context while everything else stays fixed. This is what reading a long document chunk by chunk looks like, each chunk on top of everything already read, and why long contexts are expensive.`}
      />

      <H2>What has to stay in memory</H2>
      <P>
        The cache is also where a running model’s memory goes. The weights are fixed: {bytesText(u8.weights)} for the 8B model in BF16, the lookup table included.
        The cache grows with every
        token of every conversation being served at once. In the next demonstration, choose a model and how many conversations it is holding, and how long each one
        is, and compare what they need with the 80 GB of one A-class. About a tenth is kept free for the working space a running model needs, so the dashed line
        marks what is left for weights and cache:
      </P>

      <Figure name="Neural Network Execution Explorer · memory" scenario={mem}>
        <Segmented
          label="Model"
          value={model}
          onChange={(v) => mem.set({ model: v })}
          options={[
            { value: '8B', label: '8B model' },
            { value: '70B', label: '70B model' },
          ]}
        />
        <MemoryChart u={u} model={model} convs={convs} length={length} />
        <Readouts
          items={[
            { label: 'weights', value: bytesText(u.weights), tone: 'violet' },
            { label: 'cache per token', value: `${fmt(u.perToken)} bytes`, tone: 'violet' },
            { label: 'cache in all', value: bytesText(u.cache), tone: 'violet' },
            { label: 'of one A-class’s usable room', value: pctText(u.total / u.usable), tone: u.fits ? 'ink' : 'red' },
          ]}
        />
        <Slider label="Conversations at once" tone="ink" value={convs} min={0} max={128} onChange={(v) => mem.set({ convs: v })} display={fmt(convs)} />
        <Slider
          label="Length of each"
          tone="violet"
          value={lk}
          min={LENGTH_MIN_K}
          max={LENGTH_MAX_K}
          onChange={(v) => mem.set({ lk: v })}
          display={`${fmt(length)} tokens`}
        />
      </Figure>

      <P>
        Set {fmt(u8Convs)} conversations of {fmt(u8Length)} tokens: they hold {bytesText(u8.cache)} of keys and values for the 8B model, more than twice the weights.
        Beside its weights, one A-class has room for {fmt(u8.kvTokens)} tokens of cache, about {fmt(room4k)} such conversations, and serving more of them at once is
        exactly what the batching of <a href={lessonHref('compute/2.3')}>Lesson 2.3</a> needs to make each pass over the weights pay. Memory, not arithmetic, sets that limit. Switch to the 70B model and the weights alone,{' '}
        {bytesText(u70.weights)}, are too big for one A-class before a single conversation starts; each of its tokens also needs {fmt(kvBytesPerToken(MODELS['70B']))}{' '}
        bytes of cache. A model that size has to be split across several GPUs, which brings back the links of <a href={lessonHref('compute/2.5')}>Lesson 2.5</a>.
      </P>

      <Challenge
        id="c"
        question={`Predict first, then check: how many conversations of ${fmt(CHALLENGE_LENGTH)} tokens can one A-class hold beside the 8B model? Set the length, then the most conversations that still fit.`}
        solved={solvedC}
        status={statusC}
        success={`Solved: ${fmt(roomChallenge)} conversations, half the ${fmt(room4k)} of ${fmt(4096)} tokens. The room for the cache is ${fmt(u8.kvTokens)} tokens however they are shared out, so doubling the length of each conversation halves how many fit — and how many requests a GPU can batch to share each read of the weights, which is one reason long contexts cost more to serve.`}
      />

      <P>
        Everything so far runs a model that has already been trained. Training runs the same layers forward on known text and then works backward through every one
        of them to find how each weight should change, which takes about three times the arithmetic of the forward pass alone and{' '}
        {SMALL_NUMBERS[trainStateRatio] ?? fmt(trainStateRatio)} times the memory for each weight; <a href={lessonHref('compute/3.3')}>Lesson 3.3</a> works out what that means for a whole run. So a single model already makes
        three different demands. Reading a prompt wants arithmetic. Writing a reply wants memory bandwidth, and room for a cache that
        grows with every conversation. Training wants arithmetic, memory and fast links all at once, for weeks. A GPU-hour spent on each buys a different thing. In
        the <a href={lessonHref('compute/3.2')}>next lesson</a> we put a model into service and see what it takes to make writing replies efficient.
      </P>
    </LessonPage>
  );
}
