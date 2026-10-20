// Approved tools the model may call. The model never touches the database
// directly: every tool validates its arguments, checks the caller's role and
// then calls a fixed backend routine. Tool results are untrusted data to the
// model, and only the fields listed here are ever returned to it.
const prisma = require('../utils/db');

class ToolInputError extends Error {}
class ToolForbiddenError extends Error {}

const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];

function str(value, name, { min = 1, max = 200, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw new ToolInputError(`${name} is required`);
  }
  if (typeof value !== 'string') throw new ToolInputError(`${name} must be a string`);
  const v = value.trim();
  if (v.length < min || v.length > max) {
    throw new ToolInputError(`${name} must be ${min}-${max} characters`);
  }
  return v;
}

function num(value, name, { min, max }) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ToolInputError(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const TOOLS = [
  {
    name: 'calculate_gst',
    description:
      'Calculate GST for an amount. mode "exclusive" means the amount excludes GST (add tax); "inclusive" means it already includes GST (extract tax). Returns a CGST/SGST or IGST split.',
    roles: ['user', 'admin'],
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Amount in INR' },
        rate: { type: 'number', description: 'GST rate percent: 0, 0.25, 3, 5, 12, 18 or 28' },
        mode: { type: 'string', enum: ['exclusive', 'inclusive'] },
        inter_state: { type: 'boolean', description: 'true for IGST (inter-state supply), false for CGST+SGST' },
      },
      required: ['amount', 'rate', 'mode'],
    },
    validate(a) {
      const rate = num(a.rate, 'rate', { min: 0, max: 28 });
      if (!GST_RATES.includes(rate)) throw new ToolInputError(`rate must be one of ${GST_RATES.join(', ')}`);
      if (a.mode !== 'exclusive' && a.mode !== 'inclusive') throw new ToolInputError('mode must be exclusive or inclusive');
      return {
        amount: num(a.amount, 'amount', { min: 0, max: 1e12 }),
        rate,
        mode: a.mode,
        interState: a.inter_state === true,
      };
    },
    async run({ amount, rate, mode, interState }) {
      const base = mode === 'exclusive' ? amount : amount / (1 + rate / 100);
      const tax = round2(base * (rate / 100));
      const out = {
        taxable_value: round2(base),
        gst_rate_percent: rate,
        total_gst: tax,
        total_amount: round2(base + tax),
      };
      if (interState) out.igst = tax;
      else { out.cgst = round2(tax / 2); out.sgst = round2(tax / 2); }
      return out;
    },
  },
  {
    name: 'get_my_profile',
    description: "Get the signed-in user's own name, email and role.",
    roles: ['user', 'admin'],
    parameters: { type: 'object', properties: {} },
    validate: () => ({}),
    async run(_args, ctx) {
      if (!ctx.userId) throw new ToolForbiddenError('Not signed in');
      const u = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { name: true, email: true, role: true, createdAt: true },
      });
      return u || { note: 'Profile not found' };
    },
  },
  {
    name: 'get_my_conversation_summary',
    description: "Summarise the signed-in user's own chat: message count and their most recent questions.",
    roles: ['user', 'admin'],
    parameters: {
      type: 'object',
      properties: { recent: { type: 'number', description: 'How many recent user questions to include (1-10)' } },
    },
    validate: (a) => ({
      recent: a.recent === undefined ? 5 : Math.floor(num(a.recent, 'recent', { min: 1, max: 10 })),
    }),
    async run({ recent }, ctx) {
      const where = { roomId: ctx.roomId }; // always the caller's own room
      const [total, recentUser] = await Promise.all([
        prisma.message.count({ where }),
        prisma.message.findMany({
          where: { ...where, sender: 'user' },
          orderBy: { createdAt: 'desc' },
          take: recent,
          select: { text: true, createdAt: true },
        }),
      ]);
      return {
        total_messages: total,
        recent_questions: recentUser.map((m) => ({ text: m.text.slice(0, 300), at: m.createdAt })),
      };
    },
  },
  {
    name: 'request_human_support',
    description:
      'Escalate the conversation to a human support agent. This is a sensitive action: ask the user first and only call with confirmed=true after they explicitly agree.',
    roles: ['user', 'admin'],
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Short reason for the escalation' },
        confirmed: { type: 'boolean', description: 'true only if the user explicitly agreed in their latest message' },
      },
      required: ['reason', 'confirmed'],
    },
    validate: (a) => ({ reason: str(a.reason, 'reason', { max: 300 }), confirmed: a.confirmed === true }),
    async run({ reason, confirmed }, ctx) {
      if (!confirmed) return { status: 'confirmation_required', note: 'Ask the user to confirm before escalating.' };
      const message = await prisma.message.create({
        data: {
          roomId: ctx.roomId,
          sender: 'bot',
          type: 'support_request',
          text: `A human support agent has been requested. Reason: ${reason}`,
          metadata: { timestamp: new Date().toISOString(), reason },
        },
      });
      ctx.io.to(ctx.roomId).emit('message', message);
      ctx.io.to('admins').emit('support_requested', { roomId: ctx.roomId, reason });
      await prisma.room.update({ where: { id: ctx.roomId }, data: { lastMessage: new Date() } });
      return { status: 'requested', note: 'Support team has been notified.' };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// Only tools the caller's role may use are even shown to the model.
function toolDeclarationsFor(role) {
  return TOOLS.filter((t) => t.roles.includes(role)).map((t) => {
    const decl = { name: t.name, description: t.description };
    if (Object.keys(t.parameters.properties || {}).length) {
      decl.parametersJsonSchema = { ...t.parameters, additionalProperties: false };
    }
    return decl;
  });
}

// Runs one model-requested tool call. Never throws: failures become a short,
// non-revealing error object the model can explain to the user.
async function executeTool(name, rawArgs, ctx) {
  const tool = BY_NAME.get(name);
  if (!tool) return { error: 'Unknown tool.' };

  try {
    if (!tool.roles.includes(ctx.role)) throw new ToolForbiddenError('Not permitted');
    // Gemini hands back an already-parsed object.
    const args = rawArgs === undefined || rawArgs === null ? {} : rawArgs;
    if (typeof args !== 'object' || Array.isArray(args)) {
      throw new ToolInputError('Arguments must be an object');
    }
    return await tool.run(tool.validate(args), ctx);
  } catch (err) {
    if (err instanceof ToolInputError) return { error: `Invalid input: ${err.message}` };
    if (err instanceof ToolForbiddenError) return { error: 'You are not permitted to use this tool.' };
    console.error(`[ai] tool ${name} failed:`, err);
    return { error: 'The tool is temporarily unavailable.' };
  }
}

module.exports = { toolDeclarationsFor, executeTool, TOOLS };
