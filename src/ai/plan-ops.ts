// The operations an AI can apply to a plan, parsed from loose JSON into typed
// values with messages that say exactly what is wrong. Plain code, no Nest or
// Prisma, so the parsing rules are easy to test.

export type SectionType = 'ESSENTIAL' | 'FLEXIBLE' | 'SAVINGS' | 'GOAL';
export type AccountType = 'SPENDING' | 'SAVINGS';
export type GoalMode = 'TARGET' | 'MONTHLY_RECURRING' | 'RESERVE';
export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY';

const SECTION_TYPES: SectionType[] = ['ESSENTIAL', 'FLEXIBLE', 'SAVINGS', 'GOAL'];
const ACCOUNT_TYPES: AccountType[] = ['SPENDING', 'SAVINGS'];
const GOAL_MODES: GoalMode[] = ['TARGET', 'MONTHLY_RECURRING', 'RESERVE'];
const FREQUENCIES: Frequency[] = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY'];

/** A reference to something: its id, or "$name" for something an earlier op created. */
export type Ref = string;

export type PlanOp =
  | { op: 'rename_plan'; name: string }
  | { op: 'add_account'; ref?: string; name: string; type: AccountType; startingBalance?: number }
  | { op: 'rename_account'; account: Ref; name: string }
  | { op: 'remove_account'; account: Ref }
  | {
      op: 'add_section';
      ref?: string;
      name: string;
      type: SectionType;
      percentage?: number;
      remainder?: boolean;
      parent?: Ref;
      account?: Ref;
      protected?: boolean;
    }
  | {
      op: 'update_section';
      section: Ref;
      name?: string;
      type?: SectionType;
      percentage?: number;
      remainder?: boolean;
      parent?: Ref | null;
      account?: Ref | null;
      protected?: boolean;
    }
  | { op: 'remove_section'; section: Ref }
  | { op: 'reorder_sections'; sections: Ref[] }
  | { op: 'add_bill'; ref?: string; section: Ref; name: string; amount: number; dueDay?: number }
  | { op: 'update_bill'; bill: Ref; name?: string; amount?: number; dueDay?: number | null }
  | { op: 'remove_bill'; bill: Ref }
  | {
      op: 'add_goal';
      ref?: string;
      section: Ref;
      mode?: GoalMode;
      targetAmount: number;
      targetDate?: string;
      startingAmount?: number;
    }
  | { op: 'update_goal'; goal: Ref; targetAmount?: number; targetDate?: string; startingAmount?: number }
  | { op: 'remove_goal'; goal: Ref }
  | { op: 'add_income'; ref?: string; source: string; amount: number; account: Ref; date: string; frequency: Frequency }
  | {
      op: 'update_income';
      income: Ref;
      source?: string;
      amount?: number;
      frequency?: Frequency;
      nextPayday?: string;
      account?: Ref;
    }
  | { op: 'remove_income'; income: Ref };

export const OP_NAMES = [
  'rename_plan',
  'add_account',
  'rename_account',
  'remove_account',
  'add_section',
  'update_section',
  'remove_section',
  'reorder_sections',
  'add_bill',
  'update_bill',
  'remove_bill',
  'add_goal',
  'update_goal',
  'remove_goal',
  'add_income',
  'update_income',
  'remove_income',
] as const;

/** Ops that create, rename or remove an account, which needs the accounts:write scope. */
export const ACCOUNT_OPS = new Set(['add_account', 'rename_account', 'remove_account']);

type Raw = Record<string, unknown>;

class Reader {
  constructor(private readonly raw: Raw) {}

  private has(key: string) {
    return this.raw[key] !== undefined;
  }

  string(key: string, opts: { required?: boolean; max?: number } = {}): string | undefined {
    const v = this.raw[key];
    if (v === undefined) {
      if (opts.required) throw new Error(`${key} is required`);
      return undefined;
    }
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`${key} must be a non-empty text`);
    if (opts.max && v.length > opts.max) throw new Error(`${key} is too long (max ${opts.max})`);
    return v.trim();
  }

  number(key: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | undefined {
    const v = this.raw[key];
    if (v === undefined) {
      if (opts.required) throw new Error(`${key} is required`);
      return undefined;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${key} must be a number`);
    if (opts.min !== undefined && v < opts.min) throw new Error(`${key} must be at least ${opts.min}`);
    if (opts.max !== undefined && v > opts.max) throw new Error(`${key} must be at most ${opts.max}`);
    if (Math.round(v * 100) / 100 !== v) throw new Error(`${key} can have at most 2 decimals`);
    return v;
  }

  bool(key: string): boolean | undefined {
    const v = this.raw[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'boolean') throw new Error(`${key} must be true or false`);
    return v;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], required = false): T | undefined {
    const v = this.raw[key];
    if (v === undefined) {
      if (required) throw new Error(`${key} is required (one of ${allowed.join(', ')})`);
      return undefined;
    }
    if (typeof v !== 'string' || !allowed.includes(v as T)) throw new Error(`${key} must be one of ${allowed.join(', ')}`);
    return v as T;
  }

  date(key: string, required = false): string | undefined {
    const v = this.string(key, { required });
    if (v === undefined) return undefined;
    if (Number.isNaN(new Date(v).getTime())) throw new Error(`${key} must be a date like 2026-12-31`);
    return v;
  }

  /** An id or "$name"; with nullable, an explicit null is allowed (meaning "none"). */
  ref(key: string, opts: { required?: boolean; nullable: true }): Ref | null | undefined;
  ref(key: string, opts?: { required?: boolean; nullable?: false }): Ref | undefined;
  ref(key: string, opts: { required?: boolean; nullable?: boolean } = {}): Ref | null | undefined {
    const v = this.raw[key];
    if (v === undefined) {
      if (opts.required) throw new Error(`${key} is required`);
      return undefined;
    }
    if (v === null) {
      if (opts.nullable) return null;
      throw new Error(`${key} cannot be null`);
    }
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`${key} must be an id or a $name reference`);
    return v.trim();
  }

  name(key: string): string | undefined {
    const v = this.string(key);
    if (v !== undefined && !/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(v)) {
      throw new Error(`${key} must be a short name of letters, digits, - or _ (it is referenced as $name)`);
    }
    return v;
  }

  refs(key: string): Ref[] {
    const v = this.raw[key];
    if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== 'string' || !x)) {
      throw new Error(`${key} must be a non-empty list of ids or $names`);
    }
    return v as string[];
  }

  has_(key: string) {
    return this.has(key);
  }
}

/** Parses one op, or throws an Error saying what is wrong with it. */
export function parseOp(raw: Raw): PlanOp {
  const op = raw.op;
  if (typeof op !== 'string' || !(OP_NAMES as readonly string[]).includes(op)) {
    throw new Error(`op must be one of: ${OP_NAMES.join(', ')}`);
  }
  const r = new Reader(raw);

  switch (op) {
    case 'rename_plan':
      return { op, name: r.string('name', { required: true, max: 80 })! };
    case 'add_account':
      return {
        op,
        ref: r.name('ref'),
        name: r.string('name', { required: true, max: 60 })!,
        type: r.oneOf('type', ACCOUNT_TYPES, true)!,
        startingBalance: r.number('startingBalance'),
      };
    case 'rename_account':
      return { op, account: r.ref('account', { required: true })!, name: r.string('name', { required: true, max: 60 })! };
    case 'remove_account':
      return { op, account: r.ref('account', { required: true })! };
    case 'add_section': {
      const remainder = r.bool('remainder') ?? false;
      const percentage = r.number('percentage', { min: 0, max: 100 });
      if (!remainder && percentage === undefined) throw new Error('percentage is required unless remainder is true');
      if (remainder && percentage !== undefined && percentage !== 0) throw new Error('a remainder section takes whatever is left, so give no percentage');
      return {
        op,
        ref: r.name('ref'),
        name: r.string('name', { required: true, max: 60 })!,
        type: r.oneOf('type', SECTION_TYPES, true)!,
        percentage,
        remainder,
        parent: r.ref('parent'),
        account: r.ref('account'),
        protected: r.bool('protected'),
      };
    }
    case 'update_section': {
      const remainder = r.bool('remainder');
      const percentage = r.number('percentage', { min: 0, max: 100 });
      if (remainder && percentage !== undefined && percentage !== 0) throw new Error('a remainder section takes whatever is left, so give no percentage');
      return {
        op,
        section: r.ref('section', { required: true })!,
        name: r.string('name', { max: 60 }),
        type: r.oneOf('type', SECTION_TYPES),
        percentage,
        remainder,
        parent: r.ref('parent', { nullable: true }),
        account: r.ref('account', { nullable: true }),
        protected: r.bool('protected'),
      };
    }
    case 'remove_section':
      return { op, section: r.ref('section', { required: true })! };
    case 'reorder_sections':
      return { op, sections: r.refs('sections') };
    case 'add_bill':
      return {
        op,
        ref: r.name('ref'),
        section: r.ref('section', { required: true })!,
        name: r.string('name', { required: true, max: 80 })!,
        amount: r.number('amount', { required: true, min: 0.01 })!,
        dueDay: r.number('dueDay', { min: 1, max: 31 }),
      };
    case 'update_bill': {
      const dueDay = raw.dueDay === null ? null : r.number('dueDay', { min: 1, max: 31 });
      return { op, bill: r.ref('bill', { required: true })!, name: r.string('name', { max: 80 }), amount: r.number('amount', { min: 0.01 }), dueDay };
    }
    case 'remove_bill':
      return { op, bill: r.ref('bill', { required: true })! };
    case 'add_goal': {
      const mode = r.oneOf('mode', GOAL_MODES);
      const targetDate = r.date('targetDate');
      if ((mode ?? 'TARGET') === 'TARGET' && !targetDate) throw new Error('targetDate is required for a TARGET goal');
      return {
        op,
        ref: r.name('ref'),
        section: r.ref('section', { required: true })!,
        mode,
        targetAmount: r.number('targetAmount', { required: true, min: 0.01 })!,
        targetDate,
        startingAmount: r.number('startingAmount', { min: 0 }),
      };
    }
    case 'update_goal':
      return {
        op,
        goal: r.ref('goal', { required: true })!,
        targetAmount: r.number('targetAmount', { min: 0.01 }),
        targetDate: r.date('targetDate'),
        startingAmount: r.number('startingAmount', { min: 0 }),
      };
    case 'remove_goal':
      return { op, goal: r.ref('goal', { required: true })! };
    case 'add_income':
      return {
        op,
        ref: r.name('ref'),
        source: r.string('source', { required: true, max: 120 })!,
        amount: r.number('amount', { required: true, min: 0.01 })!,
        account: r.ref('account', { required: true })!,
        date: r.date('date', true)!,
        frequency: r.oneOf('frequency', FREQUENCIES, true)!,
      };
    case 'update_income':
      return {
        op,
        income: r.ref('income', { required: true })!,
        source: r.string('source', { max: 120 }),
        amount: r.number('amount', { min: 0.01 }),
        frequency: r.oneOf('frequency', FREQUENCIES),
        nextPayday: r.date('nextPayday'),
        account: r.ref('account'),
      };
    case 'remove_income':
      return { op, income: r.ref('income', { required: true })! };
  }
  throw new Error(`unknown op ${String(op)}`);
}

/** Parses every op, collecting all the problems (not just the first). */
export function parseOps(raws: Raw[]): { ops: PlanOp[]; errors: string[] } {
  const ops: PlanOp[] = [];
  const errors: string[] = [];
  const refs = new Set<string>();
  raws.forEach((raw, i) => {
    try {
      const op = parseOp(raw);
      if ('ref' in op && op.ref) {
        if (refs.has(op.ref)) throw new Error(`ref "${op.ref}" is used twice`);
        refs.add(op.ref);
      }
      ops.push(op);
    } catch (e) {
      errors.push(`ops[${i}] (${String(raw.op)}): ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return { ops, errors };
}
