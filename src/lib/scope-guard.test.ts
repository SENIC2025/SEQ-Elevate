import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/*
 * The guard test (Release 3, D75, spec 3.6; FD-U15). It parses every source
 * file under src/ (tests excluded) with the TypeScript compiler and finds
 * every database call that can return or change a person's data:
 *
 *   - reads and writes on the learner models (membership, courseEnrollment,
 *     compCard, compCardEntry, observation, validation, userBadge,
 *     missionProgress, session, user, projectProfile, staffHistory);
 *   - every read of the audit log (it holds everyone's activity, whatever a
 *     call filters on), and its writes that filter on actorId or entityId;
 *   - a call on ANY model whose include or select names, at any depth, a
 *     relation that leads to people's data (memberships, enrollments,
 *     profiles, user, …), constants of the same file followed; an include
 *     or select the test can't follow counts too; so does such a relation
 *     read by its own method (`….findUnique(…).memberships()`), and a write
 *     whose data reaches one (`cohort.update({ data: { memberships: … } })`);
 *   - every $queryRaw, $queryRawUnsafe, $executeRaw, $executeRawUnsafe.
 *
 * A call is recognised by its shape, `<any client>.<model>.<method>(…)`,
 * whatever the client is called (prisma, tx, db, …), the model or the
 * method also by a string in brackets, or the model kept in a variable
 * (`const cards = prisma.compCard`, `const { user } = prisma`); the model
 * must be one of schema.prisma's.
 *
 * Each hit is named `file#function` (the nearest named function around it)
 * and must be on the allow-list below, in one of three groups:
 *
 *   staff   people managers' and supporters' readers and writers: allowed
 *           only when the function asks the scope module (a builder,
 *           inScope, cohortInScope or requireAdminProject imported from
 *           @/lib/scope) — directly, through a function of the same file
 *           that does, or, for a function the file doesn't export, when
 *           every caller in the file does;
 *   own     a person's own data: allowed only when every call is keyed to
 *           the signed-in person (the value requireLearner, getCurrentUser,
 *           requireUser or auth() returns, or a parameter every caller in
 *           the file fills with it), at the top of its where (or in an AND,
 *           or a compound unique key: never under NOT, OR or a relation's
 *           filter), or to the id of a row the same function read that way;
 *           an id taken from the function's arguments fails; so does an
 *           include or select that goes past the person's own rows (to a
 *           cohort's members, a course's other learners, a note's author),
 *           and raw SQL not keyed as `"userId" = ${the person's id}`;
 *   system  counts and system paths, each with its reason.
 *
 * A new hit anywhere fails until someone adds it with a reason, and an
 * entry nothing matches any more fails too. Writes of a person's
 * organisation (ProjectProfile.organisationId, or its organisation
 * relation, directly or through a nested write of profiles from a user, a
 * project or an organisation) are allowed only in setPersonOrganisation
 * (D101). Complements src/app/actions/use-server-exports.test.ts.
 *
 * A Scope is made only by the scope module (hardening SS4): its type is
 * branded and read-only, so neither a hand-made literal nor a changed copy
 * or a change in place of a real one type-checks (src/lib/scope-brand.test.ts
 * checks that with tsc). What would get round the type check fails here
 * instead, anywhere in src/ outside tests and the module, read with the
 * type checker (so whatever the type is spelled as: an alias, Viewer["scope"],
 * ReturnType<…>, an import type): the module's test-only factories
 * (testOnlyScope, testOnlyScopeFor); an assertion (as, angle brackets) to a
 * Scope or to a type holding one, of a value that isn't one or holds an any
 * (Promise<any>); a value of type any or never where a Scope is expected,
 * or one holding an any or a never in an array, a tuple or a promise; an
 * object literal there; Object.assign, defineProperty and the like on a
 * Scope, or copying one into another object, however the function is named
 * where it is called; a call of a generic function of src/ that makes a
 * value of its own type parameter (an assertion to it, a spread of it,
 * Object.assign, an any given where it is expected), when a Scope comes out
 * of it; a type predicate or assertion function (`x is Scope`); an overload
 * that answers a Scope; a server action (an exported function of a
 * "use server" module, or a function that says "use server") that takes a
 * Scope or a Viewer from its caller, also through a library type of one
 * (Pick<Viewer, "scope">, Partial<Viewer>, Omit, Readonly). An action is
 * found by its export where it is declared: use-server-exports.test.ts
 * refuses an export list, export * and export default of a value in every
 * "use server" module of src/.
 *
 * What a static reading can't follow (a generic class whose method makes
 * its class's type parameter's value, a generic function that hands what
 * it makes to a callback, code outside src/) meets the scope module's
 * run-time check instead: every function of it that takes a Scope throws
 * for a value the module didn't make (src/lib/scope-runtime.test.ts).
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/* ------------------------------ The scanner ------------------------------ */

const READS = new Set([
  "findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "count", "aggregate",
  "groupBy",
]);
const WRITES = new Set([
  "create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert",
  "delete", "deleteMany",
]);
const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);
const LEARNER_MODELS = new Set([
  "membership", "courseEnrollment", "compCard", "compCardEntry", "observation", "validation", "userBadge",
  "missionProgress", "session", "user", "projectProfile", "staffHistory",
]);
/*
 * The spec's list (3.6), plus the schema's other relations that lead to a
 * person or their data: User.auditEvents (the spec's auditLogs is
 * Project's), User.missionProgress, Mission.progress, CompCard.entries,
 * User.accounts, and the to-one relations observed, validated, observer,
 * validator and actor.
 */
const LEARNER_RELATIONS = new Set([
  "memberships", "enrollments", "compCards", "compCardEntries", "profiles", "sharedCompCards",
  "staffHistory", "observedNotes", "validatedNotes", "observations", "validations", "unlockedBy", "badges",
  "sessions", "auditLogs", "user", "auditEvents", "missionProgress", "progress", "entries", "observed",
  "validated", "observer", "validator", "actor", "accounts",
]);
const RAW = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);
/** What the scope module guards with (spec 3.2). */
const SCOPE_GUARDS = new Set([
  "learnerUsersInScope", "learnerMembershipsInScope", "statisticsMembershipsInScope", "peopleInScope",
  "membershipsInScope", "organisationsInScope", "cohortsInScope", "inScope", "cohortInScope",
  "requireAdminProject",
]);
/**
 * What hands back the signed-in person (or their session): these imports,
 * or a function of the same file that returns what one of them gave
 * (learner.ts's requireLearner, a11y.ts's signedInUser).
 */
const SESSION_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  "@/lib/auth-helpers": ["getCurrentUser", "requireUser"],
  "@/auth": ["auth"],
};
/** Tables of people's data, for raw SQL in own-data functions. */
const LEARNER_TABLES =
  /"(User|Membership|CourseEnrollment|CompCard|CompCardEntry|Observation|Validation|UserBadge|MissionProgress|Session|ProjectProfile|StaffHistory|AuditLog)"/;

const SCHEMA = readFileSync(`${ROOT}prisma/schema.prisma`, "utf8");
const MODEL_NAMES = [...SCHEMA.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
/** The Prisma models of schema.prisma, as their client delegates are named. */
const MODELS = new Set(MODEL_NAMES.map((m) => m[0].toLowerCase() + m.slice(1)));
/** The name of every relation field of every model (a field whose type is a model). */
const RELATIONS = new Set(
  [...SCHEMA.matchAll(/^model \w+ \{\n([\s\S]*?)^\}/gm)].flatMap((m) =>
    m[1].split("\n").flatMap((line) => {
      const f = /^\s*(\w+)\s+(\w+)/.exec(line.replace(/\/\/.*$/, ""));
      return f && MODEL_NAMES.includes(f[2]) ? [f[1]] : [];
    })
  )
);
/**
 * The relations that, from a row of the signed-in person's own, lead only
 * to rows of the same person: their user row, and its memberships,
 * enrolments, cards (and a card's entries), profiles, badges, sessions,
 * accounts, missions, staff history and audit rows. Not the notes: a note
 * about the person names its author, a note by them its subject. Past any
 * other relation (a cohort, a course, an organisation, a badge) a learner
 * relation reaches other people.
 */
const OWN_RELATIONS = new Set([
  "user", "memberships", "enrollments", "compCards", "entries", "profiles", "badges", "sessions", "accounts",
  "missionProgress", "staffHistory", "auditEvents", "actor",
]);
/**
 * A key of a where under which a person's id still keys the call to them:
 * AND, or a compound unique key (userId_projectId). Under anything else (NOT,
 * OR, a relation's filter) it doesn't.
 */
const keepsTheKey = (key: string) => key === "AND" || /^[a-z]\w*_\w+$/i.test(key);

type Kind = "read" | "write" | "raw" | "relation" | "audit" | "unresolved" | "organisation-write";

interface Hit {
  file: string;
  fn: string;
  kind: Kind;
  what: string;
  call: ts.CallExpression | ts.TaggedTemplateExpression;
  model: string | null;
  method: string;
  /** What the call loads: each relation's path from the call's model. */
  loads?: Loads;
  /** For a relation read by its own method, the model call it is made on. */
  on?: ts.CallExpression;
}

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

const isFunction = (n: ts.Node): n is FunctionNode =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

/** The name a function is known by: its own, or the variable or property it is assigned to. */
function functionName(fn: FunctionNode): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) return fn.name.getText();
  let p: ts.Node = fn.parent;
  // cache(async () => …), and the like: the variable the wrapper is assigned to.
  while (ts.isCallExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p)) p = p.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) return p.name.getText();
  return null;
}

/** The nearest named function around `node`, or null at module level. */
function namedFunctionOf(node: ts.Node): FunctionNode | null {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (isFunction(n) && functionName(n)) return n;
  }
  return null;
}

const nameOf = (node: ts.Node) => {
  const fn = namedFunctionOf(node);
  return fn ? functionName(fn)! : "<module>";
};

const unwrap = (e: ts.Expression): ts.Expression => {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isAwaitExpression(e)
  ) {
    e = e.expression;
  }
  return e;
};

/** The declaration `name` refers to at `at`: a variable, a parameter or a function, by scope. */
function declarationOf(
  name: string,
  at: ts.Node
): ts.VariableDeclaration | ts.ParameterDeclaration | ts.FunctionDeclaration | null {
  for (let n: ts.Node | undefined = at; n; n = n.parent) {
    if (isFunction(n)) {
      const param = n.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name);
      if (param) return param;
    }
    if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n)) {
      for (const st of n.statements) {
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === name) return d;
            if (ts.isObjectBindingPattern(d.name)) {
              for (const el of d.name.elements) if (el.name.getText() === name) return d;
            }
          }
        }
        if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
      }
    }
  }
  return null;
}

/** The function a same-file identifier names, if it is one. */
function functionDeclaredAs(name: string, at: ts.Node): FunctionNode | null {
  const d = declarationOf(name, at);
  if (!d) return null;
  if (ts.isFunctionDeclaration(d)) return d;
  if (ts.isVariableDeclaration(d) && d.initializer) {
    let init = unwrap(d.initializer);
    while (ts.isCallExpression(init) && init.arguments.length && isFunction(unwrap(init.arguments[0]))) {
      init = unwrap(init.arguments[0]);
    }
    if (isFunction(init)) return init;
  }
  return null;
}

/** The expressions a function can return. */
function returnedBy(fn: FunctionNode): ts.Expression[] {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node) => {
    if (n !== fn && isFunction(n)) return;
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return out;
}

/** What a variable is given after its declaration, in its own scope (see objectsOf). */
const MUTATIONS = new WeakMap<ts.VariableDeclaration, ts.Expression[] | null>();

/**
 * The values a variable is given after its declaration, in the block that
 * declares it: the sources of `Object.assign(v, …)` and the right side of
 * `v = …`. Null — the object can't be followed — when a property of it is
 * assigned (`v.key = …`, `v[key] = …`): the test would otherwise read only
 * what the declaration wrote, and miss a key written into the object later.
 */
function mutationsOf(d: ts.VariableDeclaration): ts.Expression[] | null {
  if (MUTATIONS.has(d)) return MUTATIONS.get(d)!;
  const name = (d.name as ts.Identifier).text;
  const scope = d.parent?.parent?.parent;
  const out: ts.Expression[] = [];
  let unfollowed = false;
  const isIt = (e: ts.Expression) => {
    const u = unwrap(e);
    return ts.isIdentifier(u) && u.text === name && declarationOf(name, u) === d;
  };
  const visit = (n: ts.Node) => {
    if (unfollowed) return;
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "Object" &&
      n.expression.name.text === "assign" &&
      n.arguments.length > 0 &&
      isIt(n.arguments[0])
    ) {
      out.push(...n.arguments.slice(1));
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const left = unwrap(n.left);
      if ((ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) && isIt(left.expression)) {
        unfollowed = true;
        return;
      }
      if (isIt(left)) out.push(n.right);
    }
    ts.forEachChild(n, visit);
  };
  if (scope) visit(scope);
  const result = unfollowed ? null : out;
  MUTATIONS.set(d, result);
  return result;
}

/**
 * The object literals an expression can be, following identifiers to
 * same-file constants (and what is assigned into them later, mutationsOf),
 * calls of same-file functions to what they return, both arms of a
 * condition, and spreads. Null when some part can't be followed (a
 * parameter, an import, a call to elsewhere, a property written into the
 * object after its declaration).
 */
function objectsOf(e: ts.Expression, seen = new Set<ts.Node>()): ts.ObjectLiteralExpression[] | null {
  e = unwrap(e);
  if (seen.has(e)) return [];
  seen.add(e);
  if (ts.isObjectLiteralExpression(e)) return [e];
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return [];
  if (ts.isConditionalExpression(e)) {
    const a = objectsOf(e.whenTrue, seen);
    const b = objectsOf(e.whenFalse, seen);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isIdentifier(e)) {
    const d = declarationOf(e.text, e);
    if (d && ts.isVariableDeclaration(d) && d.initializer && ts.isIdentifier(d.name)) {
      const later = mutationsOf(d);
      if (!later) return null;
      const all: ts.ObjectLiteralExpression[] = [];
      for (const v of [d.initializer, ...later]) {
        const objs = objectsOf(v, seen);
        if (!objs) return null;
        all.push(...objs);
      }
      return all;
    }
    return null;
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const fn = functionDeclaredAs(e.expression.text, e);
    if (!fn) return null;
    const all: ts.ObjectLiteralExpression[] = [];
    for (const r of returnedBy(fn)) {
      const objs = objectsOf(r, seen);
      if (!objs) return null;
      all.push(...objs);
    }
    return all;
  }
  return null;
}

interface Loads {
  /** Every property name under an include or select, at any depth. */
  names: Set<string>;
  /** Each relation loaded, as its path of relation names from the call's model. */
  paths: string[][];
  /** False when some include or select couldn't be followed. */
  followed: boolean;
}

/** What a call's argument `arg` loads through its include or select (constants of the file followed). */
function loadedRelations(arg: ts.Expression): Loads {
  const names = new Set<string>();
  const paths: string[][] = [];
  let followed = true;
  const walk = (e: ts.Expression, under: boolean) => {
    const objs = objectsOf(e);
    if (!objs) {
      if (under) followed = false;
      return;
    }
    for (const o of objs) {
      for (const p of o.properties) {
        if (ts.isSpreadAssignment(p)) {
          walk(p.expression, under);
          continue;
        }
        const key = p.name?.getText().replace(/^["']|["']$/g, "");
        if (!key) continue;
        const loads = under || key === "include" || key === "select";
        if (under) names.add(key);
        if (ts.isPropertyAssignment(p)) {
          // A filter (where) under an include is part of the load, not a load of its own.
          if (key === "where" && under) continue;
          const v = unwrap(p.initializer);
          if (ts.isObjectLiteralExpression(v) || ts.isIdentifier(v) || ts.isCallExpression(v) || ts.isConditionalExpression(v)) {
            walk(p.initializer, loads);
          }
        } else if (ts.isShorthandPropertyAssignment(p) && loads) {
          walk(p.name, true);
        }
      }
    }
  };
  walk(arg, false);

  // The same, as paths: a call's (or a relation's) arguments hold an include
  // or a select, whose keys are relations (or fields) loaded at that depth.
  const selection = (e: ts.Expression, path: string[]) => {
    for (const o of objectsOf(e) ?? []) {
      for (const p of o.properties) {
        if (ts.isSpreadAssignment(p)) {
          selection(p.expression, path);
          continue;
        }
        const key = p.name?.getText().replace(/^["']|["']$/g, "");
        if (!key) continue;
        const at = [...path, key];
        if (RELATIONS.has(key) || key === "_count") paths.push(at);
        if (ts.isPropertyAssignment(p)) argumentsOf(p.initializer, at);
      }
    }
  };
  const argumentsOf = (e: ts.Expression, path: string[]) => {
    for (const o of objectsOf(e) ?? []) {
      for (const p of o.properties) {
        if (ts.isSpreadAssignment(p)) {
          argumentsOf(p.expression, path);
          continue;
        }
        const key = p.name?.getText().replace(/^["']|["']$/g, "");
        if (key !== "include" && key !== "select") continue;
        if (ts.isPropertyAssignment(p)) selection(p.initializer, path);
        else if (ts.isShorthandPropertyAssignment(p)) selection(p.name, path);
      }
    }
  };
  argumentsOf(arg, []);
  return { names, paths, followed };
}

/**
 * The relations past the signed-in person's own rows among `paths` (the
 * names on each such path, in order, once): a learner relation that isn't
 * one of the person's own, or that is reached through one that isn't.
 */
function beyondOwnRows(paths: string[][]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    let last = -1;
    path.forEach((name, i) => {
      if (!LEARNER_RELATIONS.has(name)) return;
      if (!OWN_RELATIONS.has(name) || path.slice(0, i).some((n) => !OWN_RELATIONS.has(n))) last = i;
    });
    for (const name of path.slice(0, last + 1)) if (!out.includes(name)) out.push(name);
  }
  return out;
}

type Found = { key: string; value: ts.Expression }[] & { unfollowed?: boolean };

/**
 * Every property of `e` (at any depth, constants of the file followed)
 * whose name is in `keys`. `unfollowed` is set when `e` itself or a spread
 * in it is an object the test can't see, so a caller can fail closed (a
 * value deeper down, an id or a date, is a leaf).
 */
function propertiesNamed(
  e: ts.Expression,
  keys: ReadonlySet<string>,
  out: Found = [] as Found,
  seen = new Set<ts.Node>(),
  mustFollow = true
): Found {
  // An array of rows (createMany's data).
  const u = unwrap(e);
  if (ts.isArrayLiteralExpression(u)) {
    for (const el of u.elements) propertiesNamed(el, keys, out, seen, mustFollow);
    return out;
  }
  const objs = objectsOf(e);
  if (!objs) {
    if (mustFollow) out.unfollowed = true;
    return out;
  }
  for (const o of objs) {
    if (seen.has(o)) continue;
    seen.add(o);
    for (const p of o.properties) {
      if (ts.isSpreadAssignment(p)) propertiesNamed(p.expression, keys, out, seen, true);
      else if (ts.isPropertyAssignment(p)) {
        const key = p.name.getText().replace(/^["']|["']$/g, "");
        if (keys.has(key)) out.push({ key, value: p.initializer });
        propertiesNamed(p.initializer, keys, out, seen, false);
      } else if (ts.isShorthandPropertyAssignment(p) && keys.has(p.name.text)) {
        out.push({ key: p.name.text, value: p.name });
      }
    }
  }
  return out;
}

/** The object argument's property `key` (where, data, create, update), if it has one. */
function argumentProperty(call: ts.CallExpression, key: string): ts.Expression | null {
  const arg = call.arguments[0];
  if (!arg) return null;
  for (const o of objectsOf(arg) ?? []) {
    for (const p of o.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText() === key) return p.initializer;
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) return p.name;
    }
  }
  return null;
}

type Keyed = { key: string; value: ts.Expression; under: string | null }[] & { unfollowed?: boolean };

/**
 * Every property of the filter `where` whose name is in `keys`, at any
 * depth (constants of the file followed), each with the first key around it
 * under which it no longer keys the call (NOT, OR, a relation's filter; see
 * keepsTheKey), or null. `unfollowed` as propertiesNamed's.
 */
function keysInFilter(where: ts.Expression, keys: ReadonlySet<string>): Keyed {
  const out = [] as Keyed;
  const seen = new Set<ts.Node>();
  const visit = (e: ts.Expression, under: string | null, mustFollow: boolean) => {
    const u = unwrap(e);
    if (ts.isArrayLiteralExpression(u)) {
      for (const el of u.elements) visit(el, under, mustFollow);
      return;
    }
    const objs = objectsOf(e);
    if (!objs) {
      if (mustFollow) out.unfollowed = true;
      return;
    }
    for (const o of objs) {
      if (seen.has(o)) continue;
      seen.add(o);
      for (const p of o.properties) {
        if (ts.isSpreadAssignment(p)) visit(p.expression, under, true);
        else if (ts.isPropertyAssignment(p)) {
          const key = p.name.getText().replace(/^["']|["']$/g, "");
          if (keys.has(key)) out.push({ key, value: p.initializer, under });
          visit(p.initializer, under ?? (keepsTheKey(key) ? null : key), false);
        } else if (ts.isShorthandPropertyAssignment(p) && keys.has(p.name.text)) {
          out.push({ key: p.name.text, value: p.name, under });
        }
      }
    }
  };
  visit(where, null, true);
  return out;
}

/** The model a variable holds: `const cards = prisma.compCard`, or `const { compCard } = prisma`. */
function aliasedModel(id: ts.Identifier): string | null {
  const d = declarationOf(id.text, id);
  if (!d || !ts.isVariableDeclaration(d) || !d.initializer) return null;
  if (ts.isObjectBindingPattern(d.name)) {
    const el = d.name.elements.find((e) => e.name.getText() === id.text);
    const key = el ? (el.propertyName ?? el.name).getText().replace(/^["']|["']$/g, "") : null;
    return key && MODELS.has(key) ? key : null;
  }
  const init = unwrap(d.initializer);
  if (ts.isPropertyAccessExpression(init)) return MODELS.has(init.name.text) ? init.name.text : null;
  if (ts.isElementAccessExpression(init) && ts.isStringLiteralLike(init.argumentExpression)) {
    return MODELS.has(init.argumentExpression.text) ? init.argumentExpression.text : null;
  }
  return null;
}

/**
 * The model an expression is the client delegate of: `client.model`,
 * `client["model"]`, a variable holding one, or "dynamic" for
 * `client[expr]`. A name of a learner model whose declaration says nothing
 * (a parameter) counts as that model.
 */
function modelOf(target: ts.Expression): string | null | "dynamic" {
  const t = unwrap(target);
  if (ts.isPropertyAccessExpression(t)) return MODELS.has(t.name.text) ? t.name.text : null;
  if (ts.isElementAccessExpression(t)) {
    const k = t.argumentExpression;
    if (ts.isStringLiteralLike(k)) return MODELS.has(k.text) ? k.text : null;
    return "dynamic";
  }
  if (ts.isIdentifier(t)) return aliasedModel(t) ?? (LEARNER_MODELS.has(t.text) ? t.text : null);
  return null;
}

/** The method a call names, `x.m(…)` or `x["m"](…)` ("dynamic" for `x[expr](…)`), and what it is called on. */
function methodOf(call: ts.CallExpression): { method: string; target: ts.Expression } | null {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee)) return { method: callee.name.text, target: callee.expression };
  if (ts.isElementAccessExpression(callee)) {
    const k = callee.argumentExpression;
    return { method: ts.isStringLiteralLike(k) ? k.text : "dynamic", target: callee.expression };
  }
  return null;
}

/** The model and method of a database call on a model (`<client>.<model>.<read or write>(…)`), or null. */
function modelCallOf(call: ts.CallExpression): { model: string; method: string } | null {
  const m = methodOf(call);
  if (!m || !(READS.has(m.method) || WRITES.has(m.method))) return null;
  const model = modelOf(m.target);
  return model && model !== "dynamic" ? { model, method: m.method } : null;
}

/** The written data of a write call: its data, create and update. */
const writtenData = (call: ts.CallExpression) =>
  ["data", "create", "update"].flatMap((k) => {
    const v = argumentProperty(call, k);
    return v ? [v] : [];
  });

/** Models whose writes can reach a person's profile through their `profiles` relation. */
const HOLDS_PROFILES = new Set(["user", "project", "organisation"]);

/**
 * What a write sets of a person's organisation (D101), or null: on a
 * profile, its organisationId or organisation relation; through a nested
 * write of profiles from a user or a project, those; from an organisation,
 * any nested write of its profiles (connecting one moves a person). Data the
 * test can't see fails closed.
 */
function organisationWritten(model: string, call: ts.CallExpression): string | null {
  const ORGANISATION = new Set(["organisationId", "organisation"]);
  for (const data of writtenData(call)) {
    if (model === "projectProfile") {
      const found = propertiesNamed(data, ORGANISATION);
      if (found.unfollowed) return "organisationId";
      if (found.length) return found[0].key;
    }
    if (!HOLDS_PROFILES.has(model)) continue;
    // The relation is a key of the data itself (spreads followed).
    const top = topLevelProperties(data);
    if (!top) return "data the test can't follow";
    const profiles = top.get("profiles");
    if (!profiles) continue;
    if (model === "organisation") return "profiles";
    const inner = propertiesNamed(profiles, ORGANISATION);
    if (inner.unfollowed || inner.length) return "profiles' organisation";
  }
  return null;
}

/** The properties of an object (its spreads followed), or null when some part can't be followed. */
function topLevelProperties(e: ts.Expression, out = new Map<string, ts.Expression>()): Map<string, ts.Expression> | null {
  const objs = objectsOf(e);
  if (!objs) return null;
  for (const o of objs) {
    for (const p of o.properties) {
      if (ts.isSpreadAssignment(p)) {
        if (!topLevelProperties(p.expression, out)) return null;
      } else if (ts.isPropertyAssignment(p)) out.set(p.name.getText().replace(/^["']|["']$/g, ""), p.initializer);
      else if (ts.isShorthandPropertyAssignment(p)) out.set(p.name.text, p.name);
    }
  }
  return out;
}

function scanSource(file: string, text: string): { hits: Hit[]; sf: ts.SourceFile } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const add = (call: Hit["call"], kind: Kind, model: string | null, method: string, what: string, extra: Partial<Hit> = {}) =>
    hits.push({ file, fn: nameOf(call), kind, what, call, model, method, ...extra });
  const NO_LOADS: Loads = { names: new Set(), paths: [], followed: true };

  const visit = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node) && ts.isPropertyAccessExpression(node.tag) && RAW.has(node.tag.name.text)) {
      add(node, "raw", null, node.tag.name.text, node.tag.name.text);
      if (/(UPDATE|INSERT\s+INTO)\s+"ProjectProfile"[\s\S]*"organisationId"/i.test(node.template.getText())) {
        add(node, "organisation-write", "projectProfile", node.tag.name.text, `raw SQL writes ProjectProfile.organisationId`);
      }
    }
    const called = ts.isCallExpression(node) ? methodOf(node) : null;
    if (ts.isCallExpression(node) && called) {
      const { method, target } = called;
      const onModel = modelOf(target);
      const fluent = ts.isCallExpression(unwrap(target)) ? modelCallOf(unwrap(target) as ts.CallExpression) : null;
      const found = READS.has(method) || WRITES.has(method) ? onModel : null;
      if (RAW.has(method)) add(node, "raw", null, method, method);
      else if (found === "dynamic") add(node, "unresolved", null, method, `<a model chosen at run time>.${method}`);
      else if (method === "dynamic" && onModel && onModel !== "dynamic") {
        add(node, "unresolved", onModel, method, `${onModel}.<a method chosen at run time>`);
      } else if (fluent && LEARNER_RELATIONS.has(method)) {
        // A relation read by its own method: prisma.cohort.findUnique(…).memberships(…).
        const arg = node.arguments[0];
        const own = arg ? loadedRelations(arg) : NO_LOADS;
        const loads = { ...own, paths: [[method], ...own.paths.map((p) => [method, ...p])] };
        const deeper = [...own.names].filter((n) => LEARNER_RELATIONS.has(n));
        const what = `${fluent.model}.${fluent.method}().${method}${deeper.length ? ` loads ${deeper.join(", ")}` : ""}`;
        add(node, "relation", fluent.model, method, what, { loads, on: unwrap(target) as ts.CallExpression });
      } else if (found) {
        const model = found;
        const arg = node.arguments[0];
        const loads = arg ? loadedRelations(arg) : NO_LOADS;
        const relations = [...loads.names].filter((n) => LEARNER_RELATIONS.has(n));
        const organisation = WRITES.has(method) ? organisationWritten(model, node) : null;
        if (organisation) add(node, "organisation-write", model, method, `${model}.${method} writes ${organisation}`);
        // A write whose data reaches people's rows through a relation.
        const reached = WRITES.has(method)
          ? [...new Set(writtenData(node).flatMap((d) => propertiesNamed(d, LEARNER_RELATIONS).map((f) => f.key)))]
          : [];
        if (LEARNER_MODELS.has(model)) add(node, READS.has(method) ? "read" : "write", model, method, `${model}.${method}`, { loads });
        else if (relations.length) add(node, "relation", model, method, `${model}.${method} loads ${relations.join(", ")}`);
        else if (!loads.followed) add(node, "unresolved", model, method, `${model}.${method} (an include or select the test can't follow)`);
        else if (reached.length) add(node, "write", model, method, `${model}.${method} writes ${reached.join(", ")}`);
        else if (model === "auditLog") {
          // Every read: the log holds everyone's activity, whatever the call filters on.
          const where = argumentProperty(node, "where");
          if (READS.has(method)) add(node, "audit", model, method, `auditLog.${method}`);
          else if (where && propertiesNamed(where, new Set(["actorId", "entityId"])).length) {
            add(node, "audit", model, method, `auditLog.${method} by actorId or entityId`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { hits, sf };
}

/* ------------------------------- The judge ------------------------------- */

type Group = "staff" | "own" | "system";
type AllowList = Record<string, { group: Group; reason: string }>;

/** Calls in `fn` (nested callbacks included) of a function named `name`. */
function callsOf(root: ts.Node): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

const isExported = (fn: FunctionNode) => {
  const holder = ts.isFunctionDeclaration(fn) ? fn : namedHolder(fn);
  return !!holder && !!ts.getModifiers(holder as ts.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
};
function namedHolder(fn: FunctionNode): ts.Node | null {
  let p: ts.Node = fn.parent;
  while (ts.isCallExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p)) p = p.parent;
  return ts.isVariableDeclaration(p) ? p.parent.parent : null;
}

class FileFacts {
  private guarded = new Map<FunctionNode, boolean>();
  private sessionParam = new Map<string, boolean>();
  private sessionFunctions = new Map<FunctionNode, boolean>();
  readonly scopeImports: Set<string>;
  readonly sessionImports: Set<string>;
  readonly exportedNames: Set<string>;

  constructor(readonly sf: ts.SourceFile) {
    this.scopeImports = new Set();
    this.sessionImports = new Set();
    this.exportedNames = new Set();
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) {
        const from = st.moduleSpecifier.getText().slice(1, -1);
        const named = st.importClause?.namedBindings;
        if (named && ts.isNamedImports(named)) {
          for (const el of named.elements) {
            const imported = (el.propertyName ?? el.name).text;
            if (from === "@/lib/scope" && SCOPE_GUARDS.has(imported)) this.scopeImports.add(el.name.text);
            if (SESSION_IMPORTS[from]?.includes(imported)) this.sessionImports.add(el.name.text);
          }
        }
      }
      if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) this.exportedNames.add((el.propertyName ?? el.name).text);
      }
    }
  }

  private exported(fn: FunctionNode) {
    return isExported(fn) || this.exportedNames.has(functionName(fn) ?? "");
  }

  /** Every call of the same-file function `fn` (by its name), or null when it is used otherwise too. */
  private callSites(fn: FunctionNode): ts.CallExpression[] | null {
    const name = functionName(fn);
    if (!name || this.exported(fn)) return null;
    const sites: ts.CallExpression[] = [];
    let other = false;
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n) && n.text === name && functionDeclaredAs(name, n) === fn) {
        const p = n.parent;
        if (ts.isCallExpression(p) && p.expression === n) sites.push(p);
        else if (!(ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p)) || p.name !== n) other = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(this.sf);
    return other ? null : sites;
  }

  /** Does `fn` ask the scope module (spec 3.6 group 1)? */
  isGuarded(fn: FunctionNode, stack = new Set<FunctionNode>()): boolean {
    const known = this.guarded.get(fn);
    if (known !== undefined) return known;
    if (stack.has(fn)) return false;
    stack.add(fn);
    let ok = callsOf(fn).some((c) => {
      if (!ts.isIdentifier(c.expression)) return false;
      if (this.scopeImports.has(c.expression.text)) return true;
      const callee = functionDeclaredAs(c.expression.text, c);
      return !!callee && callee !== fn && this.isGuarded(callee, stack);
    });
    if (!ok) {
      const sites = this.callSites(fn);
      ok = !!sites && sites.length > 0 && sites.every((s) => {
        const caller = namedFunctionOf(s);
        return !!caller && this.isGuarded(caller, stack);
      });
    }
    stack.delete(fn);
    this.guarded.set(fn, ok);
    return ok;
  }

  /** Is `e` a call that gives the signed-in person (or their session)? */
  private isSessionSource(e: ts.Expression): boolean {
    const u = unwrap(e);
    if (!ts.isCallExpression(u) || !ts.isIdentifier(u.expression)) return false;
    const name = u.expression.text;
    const local = functionDeclaredAs(name, u);
    if (local) return this.returnsSession(local);
    return this.sessionImports.has(name);
  }

  /** Does the same-file function `fn` return only what a session source gave? */
  private returnsSession(fn: FunctionNode): boolean {
    const known = this.sessionFunctions.get(fn);
    if (known !== undefined) return known;
    this.sessionFunctions.set(fn, false); // a cycle answers no
    const returned = returnedBy(fn);
    const ok =
      returned.length > 0 &&
      returned.every((r) => {
        const u = unwrap(r);
        return this.isSessionSource(u) || (ts.isIdentifier(u) && this.isSessionHolder(u.text, u));
      });
    this.sessionFunctions.set(fn, ok);
    return ok;
  }

  /** Does `name` at `at` hold the signed-in person (or their session)? */
  private isSessionHolder(name: string, at: ts.Node): boolean {
    const d = declarationOf(name, at);
    return !!d && ts.isVariableDeclaration(d) && !!d.initializer && this.isSessionSource(d.initializer);
  }

  /** Is `e` the signed-in person's id? */
  isSessionId(e: ts.Expression, seen = new Set<ts.Node>()): boolean {
    const u = unwrap(e);
    if (seen.has(u)) return false;
    seen.add(u);
    if (ts.isPropertyAccessExpression(u) && u.name.text === "id") {
      const obj = unwrap(u.expression);
      if (ts.isIdentifier(obj)) return this.isSessionHolder(obj.text, obj);
      // session.user.id, (await auth())?.user?.id
      if (ts.isPropertyAccessExpression(obj) && obj.name.text === "user") {
        const holder = unwrap(obj.expression);
        return (ts.isIdentifier(holder) && this.isSessionHolder(holder.text, holder)) || this.isSessionSource(holder);
      }
      return false;
    }
    if (ts.isIdentifier(u)) {
      const d = declarationOf(u.text, u);
      if (!d) return false;
      if (ts.isVariableDeclaration(d) && d.initializer && ts.isIdentifier(d.name)) return this.isSessionId(d.initializer, seen);
      if (ts.isParameter(d)) return this.isSessionParameter(d, seen);
    }
    return false;
  }

  /** Is the parameter filled with the signed-in person's id at every same-file call? */
  private isSessionParameter(param: ts.ParameterDeclaration, seen: Set<ts.Node>): boolean {
    const fn = param.parent as FunctionNode;
    const key = `${param.pos}`;
    const known = this.sessionParam.get(key);
    if (known !== undefined) return known;
    this.sessionParam.set(key, false); // a cycle answers no
    const index = fn.parameters.indexOf(param);
    const sites = this.callSites(fn);
    const ok = !!sites && sites.length > 0 && sites.every((s) => !!s.arguments[index] && this.isSessionId(s.arguments[index], seen));
    this.sessionParam.set(key, ok);
    return ok;
  }

  /**
   * Is `e` the id of a row this function read as the person's own: `row.id`
   * of `const row = await <a call on a learner model>` in the same function,
   * where that call itself keeps the own-data rule?
   */
  isOwnRowId(e: ts.Expression, depth = 0): boolean {
    const u = unwrap(e);
    if (depth > 4 || !ts.isPropertyAccessExpression(u) || u.name.text !== "id") return false;
    const obj = unwrap(u.expression);
    if (!ts.isIdentifier(obj)) return false;
    const d = declarationOf(obj.text, obj);
    if (!d || !ts.isVariableDeclaration(d) || !d.initializer || !ts.isAwaitExpression(d.initializer)) return false;
    if (namedFunctionOf(d) !== namedFunctionOf(e)) return false;
    const read = unwrap(d.initializer);
    const call = ts.isCallExpression(read) ? modelCallOf(read) : null;
    if (!call || !LEARNER_MODELS.has(call.model)) return false;
    const r = read as ts.CallExpression;
    const hit: Hit = {
      file: "",
      fn: "",
      kind: READS.has(call.method) ? "read" : "write",
      what: "",
      call: r,
      model: call.model,
      method: call.method,
      loads: r.arguments[0] ? loadedRelations(r.arguments[0]) : undefined,
    };
    return ownDataProblem(hit, this, depth + 1) === null;
  }
}

/** Raw SQL's text with each value's place shown as `$n`, and the values. */
function rawParts(template: ts.TemplateLiteral): { before: string[]; values: ts.Expression[]; text: string } {
  if (!ts.isTemplateExpression(template)) return { before: [], values: [], text: template.text };
  const before = [template.head.text, ...template.templateSpans.slice(0, -1).map((s) => s.literal.text)];
  const values = template.templateSpans.map((s) => s.expression);
  const text = [template.head.text, ...template.templateSpans.map((s) => s.literal.text)].join(" $ ");
  return { before, values, text };
}

type Problem = { loads?: string; why: string } | null;

/** Is an own-data call keyed to the signed-in person (spec 3.6 group 2)? Null when it is; else why not. */
function ownDataProblem(hit: Hit, facts: FileFacts, depth = 0): Problem {
  if (hit.kind === "raw") {
    const call = hit.call;
    const template = ts.isTaggedTemplateExpression(call) ? call.template : null;
    if (!template) return { why: "raw SQL by string in an own-data function" };
    const { before, values, text } = rawParts(template);
    if (!LEARNER_TABLES.test(text)) return null;
    // Keyed only as "userId" = ${the person's id}, with nothing that widens it.
    const keyedHere = (i: number) =>
      facts.isSessionId(values[i]) &&
      (/"(userId|actorId)"\s*=\s*$/.test(before[i]) || (/"User"/.test(text) && /"id"\s*=\s*$/.test(before[i])));
    const widens = /<>|!=|\b(NOT|OR|UNION|EXCEPT|INTERSECT)\b/i.test(text);
    return !widens && values.some((_, i) => keyedHere(i))
      ? null
      : { why: "raw SQL on people's data not keyed to the signed-in person" };
  }
  const call = hit.on ?? (hit.call as ts.CallExpression);
  const method = hit.on ? (modelCallOf(hit.on)?.method ?? hit.method) : hit.method;
  const keyed = CREATES.has(method) ? argumentProperty(call, "data") : argumentProperty(call, "where");
  if (!keyed) return { why: "no where (or data) to key it to the signed-in person" };
  const personKeys = new Set(["userId", "actorId", ...(hit.model === "user" ? ["id"] : [])]);
  const keys = keysInFilter(keyed, personKeys);
  if (keys.unfollowed) return { why: "keyed by something the test can't follow" };
  if (!keys.length) {
    const ids = keysInFilter(keyed, new Set(["id"]));
    const ownRow = hit.model !== "user" && ids.length > 0 && ids.every((k) => k.under === null && facts.isOwnRowId(k.value, depth));
    if (!ownRow) return { why: "not keyed to a person" };
  }
  const nested = keys.find((k) => k.under !== null);
  if (nested) return { why: `${nested.key} sits under ${nested.under}` };
  const stray = keys.find((k) => !facts.isSessionId(k.value));
  if (stray) return { why: `${stray.key} isn't the signed-in person's id: ${stray.value.getText()}` };
  // What it loads stays with the person's own rows.
  if (hit.loads && !hit.loads.followed) return { why: "loads an include or select the test can't follow" };
  const beyond = beyondOwnRows(hit.loads?.paths ?? []);
  if (beyond.length) return { loads: beyond.join(", "), why: "beyond the signed-in person's own rows" };
  return null;
}

/** Every reason the sources break the rule (none: they keep it). */
function judge(sources: ReadonlyMap<string, string>, allow: AllowList): { failures: string[]; matched: Set<string> } {
  const failures: string[] = [];
  const matched = new Set<string>();
  for (const [file, text] of sources) {
    const { hits, sf } = scanSource(file, text);
    const facts = new FileFacts(sf);
    for (const hit of hits) {
      const id = `${hit.file}#${hit.fn}`;
      const where = `${id}: ${hit.what}`;
      if (hit.kind === "organisation-write") {
        if (id !== "src/lib/person-organisation.ts#setPersonOrganisation") {
          failures.push(`${where} — only setPersonOrganisation writes a person's organisation (D101)`);
        }
        continue;
      }
      const entry = allow[id];
      if (!entry) {
        failures.push(`${where} — not on the allow-list`);
        continue;
      }
      matched.add(id);
      if (entry.group === "staff") {
        const fn = namedFunctionOf(hit.call);
        if (!fn || !facts.isGuarded(fn)) failures.push(`${where} — a staff function that doesn't ask @/lib/scope`);
      } else if (entry.group === "own") {
        const problem = ownDataProblem(hit, facts);
        if (problem) failures.push(`${id}: ${hit.what}${problem.loads ? ` loads ${problem.loads}` : ""} — ${problem.why}`);
      }
    }
  }
  return { failures, matched };
}

/* ------------------------------ The allow-list ------------------------------ */

const staff = (reason: string) => ({ group: "staff" as const, reason });
const own = (reason: string) => ({ group: "own" as const, reason });
const system = (reason: string) => ({ group: "system" as const, reason });

const ALLOW: AllowList = {
  // ---- 1. Staff readers and writers: each asks the scope module ----
  "src/lib/server-queries.ts#loadLearners": staff("the facilitator roster (SP3)"),
  "src/lib/server-queries.ts#getAdminCounts": staff("the admin overview's counts (SP11)"),
  "src/lib/analytics-real.ts#buildRealAnalytics": staff("the statistics (SP9)"),
  "src/lib/admin-queries.ts#getAdminOrgs": staff("Organisations & cohorts (SP13)"),
  "src/lib/admin-queries.ts#getAdminMembers": staff("Manage people (SP14)"),
  "src/app/actions/admin.ts#inviteUser": staff("an invitation's roles, for the admin actions (SP19, SP20)"),
  "src/app/actions/admin.ts#addMember": staff("Manage people: add (SP19)"),
  "src/app/actions/admin.ts#resendInvitation": staff("Manage people: invite again (SP20)"),
  "src/app/actions/admin.ts#setMemberRoles": staff("Manage people: roles (SP21)"),
  "src/app/actions/admin.ts#assignCohort": staff("Manage people: cohort (SP22)"),
  "src/app/actions/admin.ts#removeMember": staff("Manage people: remove (SP23)"),
  "src/app/actions/admin.ts#manageable": staff("whether a manager may change a person: in scope, and their roles (SP21–SP23, SP26)"),
  "src/app/actions/admin.ts#claimable": staff("whether a partner admin may take on an account that holds nothing yet (SP19)"),
  "src/app/actions/admin.ts#deleteCohort": staff("a partner admin deletes a cohort only when it is shown everyone in it (SP18)"),
  "src/app/actions/admin.ts#deleteOrganisation": staff("an organisation is deleted only while no profile names it (SP16)"),
  "src/app/actions/admin.ts#setCountryMapping": staff("the country mapping places unplaced learners of that country (SP25)"),
  "src/app/actions/admin.ts#updatePersonProfile": staff("Manage people: a person's name, country or organisation (SP26)"),
  "src/app/actions/admin.ts#setGuardianSharing": staff("Manage people: whether a guardian's permission covers sharing the Comp Card (SP19a)"),
  "src/app/actions/facilitator.ts#requireStaffFor": staff("who a note or validation may be about (SP6, SP7)"),
  "src/app/actions/facilitator.ts#saveObservation": staff("a facilitator's note (SP6)"),
  "src/app/actions/facilitator.ts#recordValidation": staff("a facilitator's validation (SP7)"),
  "src/app/actions/admin-data.ts#personOf": staff("the person a data tool acts on, for an ADMIN with project scope (SP31)"),
  "src/app/actions/admin-data.ts#findPeople": staff("/admin/data: anyone by address, for an ADMIN with project scope (SP31)"),
  "src/app/actions/admin-data.ts#markTestAccount": staff("/admin/data: the test-account mark, for an ADMIN with project scope (SP31, D85)"),
  "src/lib/account-data.ts#reviewLists": staff("/admin/data's review lists, for an ADMIN with project scope (spec 14)"),
  "src/lib/account-data.ts#list": staff("/admin/data's review lists, for an ADMIN with project scope (spec 14)"),
  "src/lib/account-data.ts#logRows": staff("/admin/data's log viewer, for an ADMIN with project scope (spec 14)"),

  // ---- 2. A person's own data: keyed to the signed-in person ----
  "src/lib/server-queries.ts#getLearnerEnrollments": own("the dashboard's own enrolments (SP37)"),
  "src/app/actions/learner.ts#loadLearnerGlobal": own("the learner's own card, badges and enrolments (SP37)"),
  "src/app/actions/learner.ts#loadCourseProgress": own("the learner's own progress in a course (SP37)"),
  "src/app/actions/learner.ts#progressInTx": own("the learner's own progress save, in its transaction (SP37)"),
  "src/app/actions/learner.ts#lockRow": own("locks the learner's own enrolment row in a save (SP37)"),
  "src/app/actions/learner.ts#badgeMayBeGiven": own("whether the learner's own course is finished, for its badge (SP37)"),
  "src/app/actions/learner.ts#claimGuestWork": own("the browser's guest work added to the learner's own account (D79, SP37)"),
  "src/app/actions/learner.ts#claimCard": own("the guest's Comp Card added to the learner's own (D79, D80, SP37)"),
  "src/app/actions/learner.ts#claimBadges": own("the guest's badges added to the learner's own (D79, SP37)"),
  "src/app/actions/learner.ts#saveCompCard": own("the learner's own Comp Card (SP37)"),
  "src/app/actions/learner.ts#awardBadgeAction": own("the learner's own badge (SP37)"),
  "src/app/actions/learner.ts#ownProfile": own("the learner's own profile: whether the profile step is done, their organisation and the guardian rule (D79, D80)"),
  "src/app/actions/learner.ts#setCompCardSharing": own("who sees the learner's own Comp Card (SP34, D80)"),
  "src/app/api/progress/beacon/route.ts#POST": own("a course save sent as the page goes: whether the signed-in learner's own profile step is done (D37, D79)"),
  "src/app/actions/profile.ts#completeProfile": own("the profile step: the person's own profile, name and learner membership (SP34, D78)"),
  "src/app/[locale]/welcome/page.tsx#readStep": own("the profile step's page: the person's own profile (spec 5.4)"),
  "src/app/[locale]/learner/comp-card/page.tsx#sharingContext": own("whom the learner may share their own Comp Card with (D80)"),
  "src/app/actions/telemetry.ts#recordStageTime": own("the learner's own time on a lesson (SP37)"),
  "src/app/actions/video.ts#recordVideoCueAnswer": own("the learner's own video answer (SP37)"),
  "src/app/actions/a11y.ts#saveA11yPrefs": own("the person's own reading-help settings (SP37)"),
  "src/app/[locale]/account/page.tsx#Page": own("the account page's own figures (SP37)"),
  "src/app/[locale]/learner/course/[courseId]/page.tsx#resumeFor": own("where the learner resumes their own course (SP37)"),

  // ---- 3. Counts and system paths ----
  "src/lib/auth-helpers.ts#getCurrentUser": system("the signed-in person's own row, by the session's id"),
  "src/lib/auth-helpers.ts#load": system("the signed-in person's own memberships (getMemberships), by the session's id"),
  "src/lib/auth-helpers.ts#requireCompleteProfile": system("the profile step's gate: the signed-in person's own profile, by the session's id (spec 5.3)"),
  "src/lib/role-grants.ts#ensureProjectRoles": system("grants roles at sign-in to ADMIN_EMAILS and demo profiles (auth.ts) and on page load (auth-helpers.ts)"),
  "src/lib/scope.ts#getViewer": system("the scope module reads the viewer's own profile"),
  "src/lib/scope.ts#inScope": system("the scope module's own count (peopleInScope)"),
  "src/lib/person-organisation.ts#setPersonOrganisation": system("the one writer of a person's organisation (D101); called only by guarded actions and the profile step"),
  "src/lib/person-organisation.ts#releaseIfCountryElsewhere": system("the profile step's organisation rule for someone who becomes a learner after it (spec 5.4 (c)); writes through setPersonOrganisation; called by setMemberRoles and addMember after their scope checks, and by ensureLearnerMembership and completeProfile for the signed-in person"),
  "src/lib/gdpr-export.ts#collectUserData": system("a person's data export: the session's own id (/api/me/export, SP27)"),
  "src/lib/account-data.ts#lockUser": system("locks the user row an erasure or reset is about, inside its transaction (D86)"),
  "src/lib/account-data.ts#eraseAccount": system("erasure: called only by deleteMyAccount (the session's own account, SP28) and by ADMIN-only paths (eraseAccountByAdmin, the clean-up run, SP31)"),
  "src/lib/account-data.ts#adminRefusal": system("who an ADMIN may not reset or erase (self, last ADMIN, ADMIN_EMAILS); called only behind SP31"),
  "src/lib/account-data.ts#resetAccount": system("a marked test account's reset: called only by resetTestAccount (ADMIN, SP31)"),
  "src/lib/account-data.ts#accountRows": system("counts what erasing a marked test account removes: called only behind previewCleanup and runCleanup (ADMIN, SP31)"),
  "src/lib/account-data.ts#markedAccounts": system("the marked test accounts the clean-up run erases: called only behind previewCleanup and runCleanup (ADMIN, SP31)"),
  "src/lib/account-data.ts#trialCoursesStillLive": system("counts the learners of trial courses (marked or staff only), for the dry run: numbers, never people (ADMIN, SP31)"),
  "src/lib/account-data.ts#planCleanup": system("the clean-up dry run: counts only, called only behind previewCleanup and runCleanup (ADMIN, SP31)"),
  "src/lib/account-data.ts#runCleanupSteps": system("the clean-up run: demo and expired sessions; called only by runCleanup (ADMIN, SP31)"),
  "src/app/actions/demo.ts#grantRoles": system("demo sign-in, only where demo sign-in is allowed (D98)"),
  "src/app/actions/demo.ts#demoSignIn": system("demo sign-in, only where demo sign-in is allowed (D98)"),
  "src/app/actions/demo.ts#completeDemoProfile": system("demo sign-in completes the demo person's own profile (spec 5.8)"),
  "src/lib/cms/ensure-course-badge.ts#ensureCourseBadge": system("a created course's badge, given to everyone who completed it (a count-free backfill inside a save)"),
  "src/lib/cms/course-admin.ts#getCourseGrid": system("editor-rule count of a course's learners (SP32): a number, never people (spec 3.5)"),
  "src/lib/cms/course-admin.ts#getCourseOutline": system("editor-rule count of a course's learners (SP32): a number, never people (spec 3.5)"),
  "src/lib/cms/sections/store.server.ts#learnerCount": system("editor-rule count (SP32)"),
  "src/lib/cms/sections/store.server.ts#finishedCount": system("editor-rule count (SP32)"),
  "src/lib/cms/sections/store.server.ts#learnersWithDataByLesson": system("editor-rule count by lesson (SP32), raw SQL by D53's rule"),
  "src/lib/cms/sections/store.server.ts#lockCourse": system("locks a course row for an editor's change (no people's data)"),
  "src/lib/cms/sections/store.server.ts#lockLessonRow": system("locks a lesson row for an editor's change (no people's data)"),
  "src/lib/cms/sections/store.server.ts#lockLessonRowIfAny": system("locks a lesson row for an editor's change (no people's data)"),
  "src/lib/cms/lesson-plans.ts#readLessonPlans": system("reads courses' lesson lists (no people's data)"),
  "src/app/actions/course.ts#guardPublish": system("locks a course row before publishing (no people's data)"),
  "src/app/actions/course.ts#write": system("locks a course row for an editor's change (no people's data)"),
  "src/app/actions/course.ts#setCourseLanguageReady": system("switches a course's language on under its row lock (no people's data)"),
  "src/app/actions/lesson.ts#lockLesson": system("locks a lesson row for an editor's change (no people's data)"),
  "src/app/actions/structure.ts#writeIfUnchanged": system("an editor's structure change under a row lock (no people's data)"),
};

/* ------------------------- Scopes made elsewhere (SS4) ------------------------- */

/** The one module that makes a Scope. */
const SCOPE_MODULE = "src/lib/scope.ts";
/** Its factory for tests: forbidden in src/ outside tests and the module. */
const TEST_ONLY_FACTORY = "testOnlyScope";
/**
 * Its factories for tests, by name: forbidden in src/ outside tests and the
 * module. testOnlyScopeFor is the scope of roles and settings the caller
 * chooses (the module's own scopeFor isn't exported).
 */
const TEST_ONLY_FACTORIES = new Set([TEST_ONLY_FACTORY, "testOnlyScopeFor"]);
/** The brand every Scope carries (scope.ts): a class no other module can name. */
const BRAND = "MadeByTheScopeModule";
/** What changes an object in place, or copies one, without an assignment the type checker refuses. */
const IN_PLACE = new Set([
  "Object.assign", "Object.defineProperty", "Object.defineProperties", "Object.setPrototypeOf",
  "Reflect.set", "Reflect.defineProperty", "Reflect.deleteProperty", "Reflect.setPrototypeOf",
]);
/** The same, by the declaration a call resolves to, however the function is named where it is called. */
const IN_PLACE_DECLARED: Readonly<Record<string, ReadonlySet<string>>> = {
  ObjectConstructor: new Set(["assign", "defineProperty", "defineProperties", "setPrototypeOf"]),
  Reflect: new Set(["set", "defineProperty", "deleteProperty", "setPrototypeOf"]),
};

/** This project's compiler options (tsconfig.json), without emitting. */
const COMPILER_OPTIONS: ts.CompilerOptions = (() => {
  const config = ts.readConfigFile(`${ROOT}tsconfig.json`, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  return { ...options, incremental: false, noEmit: true, plugins: [] };
})();
/** The declaration files the project's type check reads besides the code (next-env.d.ts, src's own). */
const DECLARATIONS = (() => {
  const config = ts.readConfigFile(`${ROOT}tsconfig.json`, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT).fileNames.filter(
    (f) => f.endsWith(".d.ts") && !f.includes("/node_modules/") && !f.includes("/.next/")
  );
})();
/** Files read from disk, parsed once for every program below. */
const PARSED = new Map<string, ts.SourceFile>();

/**
 * A program of `files` (paths from the repository root), type-checked the
 * way tsc does it, with `text` in place of what is on disk for the files it
 * names (which need not exist).
 */
function programOf(files: readonly string[], text: ReadonlyMap<string, string> = new Map()): ts.Program {
  const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
  const virtual = new Map([...text].map(([file, source]) => [`${ROOT}${file}`, source]));
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const source = virtual.get(fileName);
    if (source !== undefined) return ts.createSourceFile(fileName, source, languageVersion, true);
    let parsed = PARSED.get(fileName);
    if (!parsed) {
      parsed = getSourceFile(fileName, languageVersion, onError, shouldCreate);
      if (parsed) PARSED.set(fileName, parsed);
    }
    return parsed;
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => virtual.has(fileName) || fileExists(fileName);
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => virtual.get(fileName) ?? readFile(fileName);
  return ts.createProgram({
    rootNames: [...DECLARATIONS, ...files.map((f) => `${ROOT}${f}`)],
    options: COMPILER_OPTIONS,
    host,
  });
}

/**
 * Where `file` (of `program`; a file of src/, tests excluded) makes a Scope
 * the scope module didn't, read with the type checker, whatever the type is
 * spelled as: "file:line: text" for each use of a test-only factory (not in
 * a `typeof`); each assertion (as, angle brackets) to a Scope, or to a type
 * holding one, of a value that isn't one already or holds an any; each
 * value of type any or never, or holding one in an array, a tuple or a
 * promise, where a Scope (or a type holding one) is expected; each object
 * literal where a Scope is expected (only a @ts-expect-error or @ts-ignore
 * lets one through); each Object.assign, defineProperty and the like on a
 * Scope or a value holding one, or copying one; each call of a generic
 * function of src/ that makes a value of its own type parameter (`x as T`,
 * a spread, Object.assign, an any where it is expected) whose result holds
 * a Scope; each type predicate to a Scope; each overload answering one; and
 * each server action with a parameter that holds a Scope. Nothing for the
 * scope module itself.
 */
function scopesMadeIn(program: ts.Program, file: string): string[] {
  if (file === SCOPE_MODULE) return [];
  const sf = program.getSourceFile(`${ROOT}${file}`);
  if (!sf) throw new Error(`${file} isn't in the program`);
  const checker = program.getTypeChecker();
  const hits: string[] = [];
  const at = (node: ts.Node, what: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push(`${file}:${line + 1}: ${what}`);
  };
  const isBrand = (type: ts.Type) => {
    const symbol = type.getSymbol();
    return (
      symbol?.getName() === BRAND &&
      !!symbol.declarations?.some((d) => d.getSourceFile().fileName === `${ROOT}${SCOPE_MODULE}`)
    );
  };
  /** Is `type` a Scope (or a union holding one), or, `depth` levels down, a type that holds one? */
  const holdsScope = (type: ts.Type, depth: number, seen = new Set<ts.Type>()): boolean => {
    if (seen.has(type)) return false;
    seen.add(type);
    if (isBrand(type)) return true;
    if (type.isUnionOrIntersection()) return type.types.some((t) => holdsScope(t, depth, seen));
    if (depth === 0 || !(type.flags & ts.TypeFlags.Object)) return false;
    // A promise, an array, a tuple: their type arguments.
    if ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
      if (checker.getTypeArguments(type as ts.TypeReference).some((t) => holdsScope(t, depth - 1, seen))) return true;
    }
    // An object type of this project's own (Viewer, a type literal), or one a
    // library type makes of a type holding a Scope (Pick<Viewer, "scope">,
    // Partial<Viewer>, Omit, Readonly, Required): its properties.
    const declared = (type.getSymbol() ?? type.aliasSymbol)?.declarations ?? [];
    const ours = declared.some((d) => d.getSourceFile().fileName.startsWith(`${ROOT}src/`));
    if (!ours && !(type.aliasTypeArguments ?? []).some((t) => holdsScope(t, depth, new Set(seen)))) return false;
    return checker
      .getPropertiesOfType(type)
      .some((p) => holdsScope(checker.getTypeOfSymbolAtLocation(p, sf), depth - 1, seen));
  };
  const LOOSE = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never;
  /**
   * Does `type` hold an any or a never `depth` levels down, inside an array,
   * a tuple, a promise or a union (`any[]`, `Promise<any>`)? Such a value is
   * assignable to the same container of Scopes without being one.
   */
  const holdsLoose = (type: ts.Type, depth: number): boolean => {
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Never)) return true;
    if (type.isUnion()) return type.types.some((t) => holdsLoose(t, depth));
    if (depth === 0 || !(type.flags & ts.TypeFlags.Object)) return false;
    if (!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)) return false;
    return checker.getTypeArguments(type as ts.TypeReference).some((t) => holdsLoose(t, depth - 1));
  };
  /** Is the call `node` Object.assign, defineProperty and the like, however it is named where it is called? */
  const changesInPlace = (node: ts.CallExpression): boolean => {
    if (ts.isPropertyAccessExpression(node.expression) && IN_PLACE.has(node.expression.getText(sf))) return true;
    const declaration = checker.getResolvedSignature(node)?.getDeclaration();
    const name = declaration?.name && ts.isIdentifier(declaration.name) ? declaration.name.text : null;
    if (!declaration || !name) return false;
    let owner: ts.Node | undefined = declaration.parent;
    if (owner && ts.isModuleBlock(owner)) owner = owner.parent;
    const ownerName =
      owner && (ts.isInterfaceDeclaration(owner) || ts.isModuleDeclaration(owner)) && ts.isIdentifier(owner.name)
        ? owner.name.text
        : null;
    return !!ownerName && !!IN_PLACE_DECLARED[ownerName]?.has(name);
  };
  /** Exported, as a function or as a constant holding one? */
  const exported = (fn: ts.FunctionLikeDeclaration): boolean => {
    const hasExport = (n: ts.Node) =>
      ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(fn)) return hasExport(fn);
    const declaration = fn.parent;
    if (!declaration || !ts.isVariableDeclaration(declaration) || declaration.initializer !== fn) return false;
    const statement = declaration.parent?.parent;
    return !!statement && ts.isVariableStatement(statement) && hasExport(statement);
  };
  /** Does a block (a file, a function's body) start with the "use server" directive? */
  const usesServer = (statements: readonly ts.Statement[] | undefined): boolean => {
    for (const s of statements ?? []) {
      if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) return false;
      if (s.expression.text === "use server") return true;
    }
    return false;
  };
  const serverModule = usesServer(sf.statements);
  /**
   * How a generic function of ours makes a value of one of its own type
   * parameters: an assertion to it (`x as T`), a spread of a value of such a
   * type, Object.assign and the like, or an any given where such a type is
   * expected (`(t): T => JSON.parse(t)`). Null when it does none of these.
   */
  const madeBy = new Map<ts.Declaration, string | null>();
  const howItMakesItsType = (declaration: ts.Declaration): string | null => {
    if (madeBy.has(declaration)) return madeBy.get(declaration)!;
    let found: string | null = null;
    if (ts.isFunctionLike(declaration) && declaration.typeParameters?.length) {
      const own = new Set(declaration.typeParameters.map((t) => t.name.text));
      const ownTypes = new Set(declaration.typeParameters.map((t) => checker.getTypeAtLocation(t)));
      /** Does `type` mention one of the function's own type parameters (T, Partial<T>, T & U)? */
      const mentionsOwn = (type: ts.Type, depth = 3): boolean => {
        if (ownTypes.has(type)) return true;
        if (depth === 0) return false;
        if (type.isUnionOrIntersection()) return type.types.some((t) => mentionsOwn(t, depth - 1));
        const alias = type.aliasTypeArguments ?? [];
        const args = type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
          ? checker.getTypeArguments(type as ts.TypeReference)
          : [];
        const mapped = (type as { typeParameter?: ts.Type; constraintType?: ts.Type }).constraintType;
        return [...alias, ...args, ...(mapped ? [mapped] : [])].some((t) => mentionsOwn(t, depth - 1));
      };
      const look = (node: ts.Node) => {
        if (found) return;
        if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && ts.isTypeReferenceNode(node.type)) {
          if (ts.isIdentifier(node.type.typeName) && own.has(node.type.typeName.text)) found = "assertion";
        }
        if ((ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) && mentionsOwn(checker.getTypeAtLocation(node.expression))) {
          found = "spread";
        }
        if (!found && ts.isCallExpression(node) && changesInPlace(node)) found = "Object.assign";
        if (!found && ts.isExpression(node) && !ts.isParenthesizedExpression(node) && given(node)) {
          if (checker.getTypeAtLocation(node).flags & ts.TypeFlags.Any) {
            const expected = checker.getContextualType(node);
            if (expected && mentionsOwn(expected)) found = "any";
          }
        }
        if (!found) ts.forEachChild(node, look);
      };
      ts.forEachChild(declaration, look);
    }
    madeBy.set(declaration, found);
    return found;
  };
  /** Is `node` a value given to something typed: an argument, an initialiser, a returned value, a property, an assigned value? */
  const given = (node: ts.Node): boolean => {
    const p = node.parent;
    if (!p) return false;
    if (ts.isParenthesizedExpression(p)) return given(p);
    if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.some((a) => a === node)) return true;
    if ((ts.isVariableDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isParameter(p)) && p.initializer === node) return true;
    if (ts.isPropertyAssignment(p) && p.initializer === node) return true;
    if (ts.isReturnStatement(p) || ts.isArrayLiteralExpression(p) || ts.isJsxExpression(p)) return true;
    if (ts.isArrowFunction(p) && p.body === node) return true;
    if (ts.isConditionalExpression(p) && (p.whenTrue === node || p.whenFalse === node)) return true;
    if (ts.isBinaryExpression(p) && p.right === node) {
      const op = p.operatorToken.kind;
      return op === ts.SyntaxKind.EqualsToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken;
    }
    return false;
  };
  /** Is `node` inside a type query (`typeof x`), where a name is only read for its type? */
  const inTypeQuery = (node: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (ts.isTypeQueryNode(n)) return true;
      if (ts.isStatement(n)) return false;
    }
    return false;
  };
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && TEST_ONLY_FACTORIES.has(node.text) && !inTypeQuery(node)) at(node, `${node.text} outside tests`);
    // A generic function of ours that makes a value of its type parameter
    // (an assertion, a spread, Object.assign, an any), called so that a
    // Scope comes out of it.
    if (ts.isCallExpression(node)) {
      const declaration = checker.getResolvedSignature(node)?.getDeclaration();
      if (
        declaration &&
        declaration.getSourceFile().fileName.startsWith(`${ROOT}src/`) &&
        declaration.getSourceFile().fileName !== `${ROOT}${SCOPE_MODULE}` &&
        holdsScope(checker.getTypeAtLocation(node), 3)
      ) {
        const how = howItMakesItsType(declaration);
        if (how) at(node, `a Scope out of a generic ${how}`);
      }
    }
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const target = checker.getTypeFromTypeNode(node.type);
      if (holdsScope(target, 3)) {
        const value = checker.getTypeAtLocation(node.expression);
        const empty = ts.isArrayLiteralExpression(node.expression) && node.expression.elements.length === 0;
        if (value.flags & LOOSE || (!empty && holdsLoose(value, 3)) || !checker.isTypeAssignableTo(value, target)) {
          at(node, holdsScope(target, 0) ? "a value asserted to be a Scope" : "a value asserted to hold a Scope");
        }
      }
    }
    // Object.assign and the like: onto a Scope (in place), or a Scope copied
    // into another object with its fields changed.
    if (ts.isCallExpression(node) && changesInPlace(node)) {
      const [target, ...sources] = node.arguments;
      if (target && holdsScope(checker.getTypeAtLocation(target), 3)) at(node, "a Scope changed in place");
      else if (sources.some((s) => holdsScope(checker.getTypeAtLocation(s), 3)) || holdsScope(checker.getTypeAtLocation(node), 3)) {
        at(node, "a Scope copied by Object.assign or the like");
      }
    }
    // A type predicate or an assertion function: `x is Scope`, `asserts x is Scope`.
    if (ts.isTypePredicateNode(node) && node.type && holdsScope(checker.getTypeFromTypeNode(node.type), 3)) {
      at(node, "a type predicate that makes a Scope");
    }
    // An overload that answers a Scope: its implementation's answer is never checked against it.
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && !node.body && node.type && !sf.isDeclarationFile) {
      if (holdsScope(checker.getTypeFromTypeNode(node.type), 3)) at(node, "an overload that answers a Scope");
    }
    // A server action (an exported function of a "use server" module, or a
    // function that says "use server" itself) whose caller, the browser,
    // would choose the Scope or the Viewer it is given.
    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      const fn = node as ts.FunctionLikeDeclaration;
      const action =
        (serverModule && exported(fn) && fn.parent && (ts.isSourceFile(fn.parent) || ts.isVariableDeclaration(fn.parent))) ||
        (fn.body && ts.isBlock(fn.body) && usesServer(fn.body.statements));
      if (action && fn.parameters.some((p) => holdsScope(checker.getTypeAtLocation(p), 3))) {
        at(node, "a server action that takes a Scope from its caller");
      }
    }
    if (ts.isExpression(node) && !ts.isParenthesizedExpression(node) && given(node)) {
      const type = checker.getTypeAtLocation(node);
      if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Never)) {
        const expected = checker.getContextualType(node);
        if (expected && holdsScope(expected, 3)) {
          at(node, `a value of type ${type.flags & ts.TypeFlags.Any ? "any" : "never"} used as a Scope`);
        }
      } else if (ts.isObjectLiteralExpression(node)) {
        const expected = checker.getContextualType(node);
        if (expected && holdsScope(expected, 0)) at(node, "an object literal used as a Scope");
      } else if (!ts.isArrayLiteralExpression(node) && holdsLoose(type, 3)) {
        const expected = checker.getContextualType(node);
        if (expected && holdsScope(expected, 3)) at(node, "a value holding any or never used as a Scope");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** scopesMadeIn for one file of src/ with `source` as its text, as if it were added (for the meta-tests). */
function scopesMadeElsewhere(file: string, source: string): string[] {
  return scopesMadeIn(programOf([file], new Map([[file, source]])), file);
}

/* --------------------------------- Tests --------------------------------- */

function sourceFiles(dir: string): string[] {
  return readdirSync(`${ROOT}${dir}`).flatMap((name) => {
    const path = `${dir}${name}`;
    if (statSync(`${ROOT}${path}`).isDirectory()) return sourceFiles(`${path}/`);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}
const SOURCES = new Map(sourceFiles("src/").map((f) => [f, readFileSync(`${ROOT}${f}`, "utf8")]));

describe("the scope guard (FD-U15)", () => {
  const { failures, matched } = judge(SOURCES, ALLOW);

  it("finds the database calls it is about", () => {
    // A scanner that finds nothing passes everything.
    expect(matched.size).toBeGreaterThan(40);
    expect(MODELS.has("projectProfile") && MODELS.has("user")).toBe(true);
  });

  it("finds no call on people's data outside its allowed place", () => {
    expect(failures).toEqual([]);
  });

  it("has no entry that nothing needs any more", () => {
    expect(Object.keys(ALLOW).filter((id) => !matched.has(id))).toEqual([]);
  });

  it("gives every entry a reason", () => {
    for (const [id, entry] of Object.entries(ALLOW)) expect(entry.reason.length, id).toBeGreaterThan(10);
  });

  it("finds no Scope made outside the scope module (SS4): no test-only factory, assertion, any or literal", { timeout: 240_000 }, () => {
    // One program of every file of src/ (tests excluded), type-checked as tsc does.
    const program = programOf([...SOURCES.keys()]);
    expect([...SOURCES.keys()].flatMap((file) => scopesMadeIn(program, file))).toEqual([]);
    // It reads the module it exempts: the factory and the brand are defined there.
    expect(SOURCES.get(SCOPE_MODULE)).toContain(`export function ${TEST_ONLY_FACTORY}(`);
    expect(SOURCES.get(SCOPE_MODULE)).toContain(`declare class ${BRAND} {`);
  });
});

describe("the scope guard refuses a Scope made outside the scope module (SS4 meta-test)", { timeout: 120_000 }, () => {
  it("the test-only factory, in any file of src/ outside tests", () => {
    expect(
      scopesMadeElsewhere(
        "src/lib/new-report.ts",
        `import { testOnlyScope } from "@/lib/scope";
         export const everyone = testOnlyScope({ kind: "project", viewerId: "x", viewerOrganisationId: null });`
      )
    ).toEqual([
      "src/lib/new-report.ts:1: testOnlyScope outside tests",
      "src/lib/new-report.ts:2: testOnlyScope outside tests",
    ]);
  });

  it("a literal asserted to be a Scope, directly, through unknown, in angle brackets or under another name", () => {
    expect(
      scopesMadeElsewhere(
        "src/app/actions/new-action.ts",
        `import type { Scope } from "@/lib/scope";
         import { type Scope as Seen } from "@/lib/scope";
         export const a = { kind: "none" } as Scope;
         export const b = { kind: "project" } as unknown as Scope;
         export const c = <Scope>{ kind: "none" };
         export const d = { kind: "none" } as Seen;`
      )
    ).toEqual([
      "src/app/actions/new-action.ts:3: a value asserted to be a Scope",
      "src/app/actions/new-action.ts:4: a value asserted to be a Scope",
      "src/app/actions/new-action.ts:5: a value asserted to be a Scope",
      "src/app/actions/new-action.ts:6: a value asserted to be a Scope",
    ]);
  });

  it("an assertion to a Scope under any spelling, and an untyped value where a Scope is expected", () => {
    expect(
      scopesMadeElsewhere(
        "src/lib/x.ts",
        `import { getViewerScope, type Scope, type Viewer } from "@/lib/scope";
         type S = Scope;
         export const a = {} as Viewer["scope"];
         export const b = {} as Awaited<ReturnType<typeof getViewerScope>>;
         export const c = {} as S;
         export const d = {} as import("@/lib/scope").Scope;
         export const e = (f: (s: Scope) => void) => f({} as never);`
      )
    ).toEqual([
      "src/lib/x.ts:3: a value asserted to be a Scope",
      "src/lib/x.ts:4: a value asserted to be a Scope",
      "src/lib/x.ts:5: a value asserted to be a Scope",
      "src/lib/x.ts:6: a value asserted to be a Scope",
      "src/lib/x.ts:7: a value of type never used as a Scope",
    ]);
  });

  it("an any where a Scope is expected, a literal let through, a Viewer asserted, a scope changed in place", () => {
    expect(
      scopesMadeElsewhere(
        "src/app/actions/new-action.ts",
        `import { getViewer, learnerUsersInScope, type Scope, type Viewer } from "@/lib/scope";
         export const a = learnerUsersInScope({ kind: "project" } as any);
         export const b: Scope = JSON.parse("{}");
         // @ts-expect-error a literal isn't a Scope
         export const c: Scope = { kind: "none" };
         export const d = async () => ({ ...(await getViewer()), scope: { kind: "none" } }) as Viewer;
         export const e = async () => Object.assign((await getViewer()).scope, { kind: "project" });
         export const f = async (): Promise<Viewer> => ({ user: null, roles: [], profile: null, scope: {} as never });`
      )
    ).toEqual([
      "src/app/actions/new-action.ts:2: a value of type any used as a Scope",
      "src/app/actions/new-action.ts:3: a value of type any used as a Scope",
      "src/app/actions/new-action.ts:5: an object literal used as a Scope",
      "src/app/actions/new-action.ts:6: a value asserted to hold a Scope",
      "src/app/actions/new-action.ts:6: an object literal used as a Scope",
      "src/app/actions/new-action.ts:7: a Scope changed in place",
      "src/app/actions/new-action.ts:8: a value of type never used as a Scope",
    ]);
  });

  it("a type reached through a builder's parameters, and a generic function that asserts to its type parameter", () => {
    expect(
      scopesMadeElsewhere(
        "src/lib/new-report.ts",
        `import { learnerUsersInScope, type Scope } from "@/lib/scope";
         export const a = { kind: "project" } as Parameters<typeof learnerUsersInScope>[0];
         const cast = <T,>(x: unknown) => x as T;
         export const b = learnerUsersInScope(cast<Scope>({ kind: "project" }));
         function launder<T>(x: unknown): { scope: T } { return { scope: x as T }; }
         export const c = learnerUsersInScope(launder<Scope>({}).scope);`
      )
    ).toEqual([
      "src/lib/new-report.ts:2: a value asserted to be a Scope",
      "src/lib/new-report.ts:4: a Scope out of a generic assertion",
      "src/lib/new-report.ts:6: a Scope out of a generic assertion",
    ]);
  });

  it("a copy of a real scope with its fields changed by Object.assign, under its own name or another", () => {
    expect(
      scopesMadeElsewhere(
        "src/lib/new-report.ts",
        `import { getViewerScope, peopleInScope, type Scope } from "@/lib/scope";
         export async function theirs(other: string) {
           const mine = await getViewerScope();
           const s: Scope = Object.assign({}, mine, { organisationId: other });
           const assign = Object.assign;
           const t: Scope = assign({}, mine, { organisationId: other });
           return [peopleInScope(s), peopleInScope(t)];
         }`
      )
    ).toEqual([
      "src/lib/new-report.ts:4: a Scope copied by Object.assign or the like",
      "src/lib/new-report.ts:6: a Scope copied by Object.assign or the like",
    ]);
  });

  it("a generic function of ours that copies its argument with a spread or Object.assign, or makes it from an any", () => {
    expect(
      scopesMadeElsewhere(
        "src/lib/new-report.ts",
        `import { getViewerScope, peopleInScope, type Scope } from "@/lib/scope";
         const withOrganisation = <T,>(s: T, organisationId: string) => ({ ...s, organisationId });
         const patched = <T extends object>(base: T, patch: Partial<T>): T => ({ ...base, ...patch });
         const merge = <A extends object, B extends object>(a: A, b: B) => Object.assign({}, a, b);
         const fromJson = <T,>(text: string): T => JSON.parse(text);
         export async function a(other: string) { return peopleInScope(withOrganisation(await getViewerScope(), other)); }
         export async function b() { return peopleInScope(patched(await getViewerScope(), { kind: "none" })); }
         export async function c(other: string) { return peopleInScope(merge(await getViewerScope(), { organisationId: other })); }
         export const d = (body: string) => peopleInScope(fromJson<Scope>(body));`
      )
    ).toEqual([
      "src/lib/new-report.ts:6: a Scope out of a generic spread",
      "src/lib/new-report.ts:7: a Scope out of a generic spread",
      "src/lib/new-report.ts:8: a Scope out of a generic Object.assign",
      "src/lib/new-report.ts:9: a Scope out of a generic any",
    ]);
  });

  it("the test-only scope of roles and settings the caller chose, anywhere outside tests", () => {
    expect(
      scopesMadeElsewhere(
        "src/app/actions/new-action.ts",
        `import { learnerUsersInScope, testOnlyScopeFor } from "@/lib/scope";
         export async function preview(userId: string) {
           return learnerUsersInScope(testOnlyScopeFor({ userId, name: "x", roles: ["ADMIN"], profile: null }, { R3_PROFILE_GATE: "off" }));
         }`
      )
    ).toEqual([
      "src/app/actions/new-action.ts:1: testOnlyScopeFor outside tests",
      "src/app/actions/new-action.ts:3: testOnlyScopeFor outside tests",
    ]);
  });

  it("an any inside an array or a promise, a type predicate or assertion function, an overload that answers a Scope", () => {
    expect(
      scopesMadeElsewhere(
        "src/lib/new-report.ts",
        `import { learnerUsersInScope, type Scope } from "@/lib/scope";
         export const a = (rows: any[]) => { const [s]: Scope[] = rows; return learnerUsersInScope(s); };
         export const b = async (body: string) => learnerUsersInScope(await (Promise.resolve(JSON.parse(body)) as Promise<Scope>));
         const isScope = (x: unknown): x is Scope => typeof x === "object" && x !== null;
         function assertScope(x: unknown): asserts x is Scope { if (!x) throw new Error("no"); }
         function asScope(x: object): Scope;
         function asScope(x: any) { return x; }
         export const c = (body: string): Scope[] => (JSON.parse(body) as unknown[]).map((x) => x as never);
         export const d = (x: unknown, y: unknown, z: object) => { assertScope(y); return [isScope(x) ? x : null, y, asScope(z)]; };`
      )
    ).toEqual([
      "src/lib/new-report.ts:2: a value holding any or never used as a Scope",
      "src/lib/new-report.ts:3: a value asserted to hold a Scope",
      "src/lib/new-report.ts:4: a type predicate that makes a Scope",
      "src/lib/new-report.ts:5: a type predicate that makes a Scope",
      "src/lib/new-report.ts:6: an overload that answers a Scope",
      "src/lib/new-report.ts:8: a value holding any or never used as a Scope",
    ]);
  });

  it("a server action that takes a Scope or a Viewer from its caller", () => {
    expect(
      scopesMadeElsewhere(
        "src/app/actions/new-action.ts",
        `"use server";
         import { getViewerScope, learnerUsersInScope, type Scope, type Viewer } from "@/lib/scope";
         export async function listLearners(cohortId: string, scope?: Scope) {
           const s = scope ?? (await getViewerScope());
           return [cohortId, learnerUsersInScope(s)];
         }
         export const rolesOf = async (viewer: Viewer) => viewer.roles;
         async function helper(scope: Scope) { return learnerUsersInScope(scope); }
         export async function mine(cohortId: string) { return [cohortId, await helper(await getViewerScope())]; }`
      )
    ).toEqual([
      "src/app/actions/new-action.ts:3: a server action that takes a Scope from its caller",
      "src/app/actions/new-action.ts:7: a server action that takes a Scope from its caller",
    ]);
  });

  it("a server action that takes a Viewer through a library type: Pick, Partial, Omit, Readonly (polish2-verify V1)", () => {
    expect(
      scopesMadeElsewhere(
        "src/app/actions/new-action.ts",
        `"use server";
         import { learnerUsersInScope, type Viewer } from "@/lib/scope";
         export async function asViewer(v: Pick<Viewer, "scope">) { return learnerUsersInScope(v.scope); }
         export async function rolesAs(v: Partial<Viewer>) { return v.scope ? learnerUsersInScope(v.scope) : null; }
         export async function without(v: Omit<Viewer, "roles">) { return learnerUsersInScope(v.scope); }
         export async function frozen(v: Readonly<Required<Viewer>>) { return learnerUsersInScope(v.scope); }
         export async function rolesOnly(v: Pick<Viewer, "roles">) { return v.roles; }`
      )
    ).toEqual([
      "src/app/actions/new-action.ts:3: a server action that takes a Scope from its caller",
      "src/app/actions/new-action.ts:4: a server action that takes a Scope from its caller",
      "src/app/actions/new-action.ts:5: a server action that takes a Scope from its caller",
      "src/app/actions/new-action.ts:6: a server action that takes a Scope from its caller",
    ]);
  });

  it("and a scope that came from the module passes", () => {
    expect(
      scopesMadeElsewhere(
        "src/lib/new-report.ts",
        `import { getViewer, getViewerScope, learnerUsersInScope, type Scope } from "@/lib/scope";
         const same = <T,>(x: T): T => x;
         export async function mine(): Promise<Scope> { const scope: Scope = await getViewerScope(); return scope; }
         export async function both() { const [scope, viewer] = await Promise.all([getViewerScope(), getViewer()]); return [scope, viewer.scope]; }
         export async function kept() { const scopes: Scope[] = []; scopes.push(same(await getViewerScope())); return scopes.map(learnerUsersInScope); }`
      )
    ).toEqual([]);
  });
});

/*
 * The meta-test: changes that must fail. Each adds a file (or a function to
 * a real file) to the real sources and judges them with the real list. Each
 * judgement parses every source file again (about 1 s alone, several times
 * that while the whole suite runs), so a test that judges several cases has
 * more time than the default 5 s.
 */
describe("the scope guard refuses (FD-U15 meta-test)", { timeout: 60_000 }, () => {
  const failuresWith = (file: string, text: string, allow: AllowList = ALLOW) => {
    const sources = new Map(SOURCES);
    sources.set(file, file in Object.fromEntries(SOURCES) ? `${SOURCES.get(file)}\n${text}` : text);
    return judge(sources, allow).failures;
  };

  it("a new Comp Card read in a file not on the list", () => {
    const failures = failuresWith(
      "src/lib/new-report.ts",
      `import { prisma } from "@/lib/prisma";
       export async function cards() { return prisma.compCard.findMany({}); }`
    );
    expect(failures).toEqual(["src/lib/new-report.ts#cards: compCard.findMany — not on the allow-list"]);
  });

  it("the same read reached another way: by name, as a delegate, or by a model chosen at run time", () => {
    const failures = failuresWith(
      "src/lib/new-report.ts",
      `import { prisma } from "@/lib/prisma";
       export async function byName() { return prisma["compCard"].findMany({}); }
       export async function delegate() { const { compCard } = prisma; return compCard.findMany({}); }
       export async function dynamic(model: string) { return (prisma as any)[model].findMany({}); }`
    );
    expect(failures).toEqual([
      "src/lib/new-report.ts#byName: compCard.findMany — not on the allow-list",
      "src/lib/new-report.ts#delegate: compCard.findMany — not on the allow-list",
      "src/lib/new-report.ts#dynamic: <a model chosen at run time>.findMany — not on the allow-list",
    ]);
  });

  it("an organisation read that loads its people's profiles, anywhere", () => {
    const failures = failuresWith(
      "src/lib/new-orgs.ts",
      `import { prisma } from "@/lib/prisma";
       export const orgs = () => prisma.organisation.findMany({ include: { profiles: { include: { user: true } } } });`
    );
    expect(failures).toEqual([
      "src/lib/new-orgs.ts#orgs: organisation.findMany loads profiles, user — not on the allow-list",
    ]);
  });

  it("the same, through a constant of the file", () => {
    const failures = failuresWith(
      "src/lib/new-orgs.ts",
      `import { prisma } from "@/lib/prisma";
       const WITH_PEOPLE = { profiles: { select: { userId: true } } } as const;
       export async function orgs() { return prisma.organisation.findMany({ include: WITH_PEOPLE }); }`
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("organisation.findMany loads profiles");
  });

  it("an include it can't follow", () => {
    const failures = failuresWith(
      "src/lib/new-orgs.ts",
      `import { prisma } from "@/lib/prisma";
       import { SOMETHING } from "@/lib/elsewhere";
       export async function orgs() { return prisma.organisation.findMany({ include: SOMETHING }); }`
    );
    expect(failures).toEqual([
      "src/lib/new-orgs.ts#orgs: organisation.findMany (an include or select the test can't follow) — not on the allow-list",
    ]);
  });

  it("findUniqueOrThrow on a user, whatever the client is called", () => {
    const failures = failuresWith(
      "src/lib/new-lookup.ts",
      `export async function who(db: unknown, id: string) {
         return (db as any).user.findUniqueOrThrow({ where: { id } });
       }`
    );
    expect(failures).toEqual(["src/lib/new-lookup.ts#who: user.findUniqueOrThrow — not on the allow-list"]);
  });

  it("raw SQL by string", () => {
    const failures = failuresWith(
      "src/lib/new-raw.ts",
      `import { prisma } from "@/lib/prisma";
       export async function raw(sql: string) { return prisma.$queryRawUnsafe(sql); }`
    );
    expect(failures).toEqual(["src/lib/new-raw.ts#raw: $queryRawUnsafe — not on the allow-list"]);
  });

  it("a write of a person's organisation outside setPersonOrganisation, even on the list", () => {
    const file = "src/lib/new-move.ts";
    const failures = failuresWith(
      file,
      `import type { Prisma } from "@prisma/client";
       export async function move(tx: Prisma.TransactionClient, userId: string, organisationId: string) {
         await tx.projectProfile.update({ where: { userId_projectId: { userId, projectId: "seq-elevate" } }, data: { organisationId } });
       }`,
      { ...ALLOW, [`${file}#move`]: system("a test entry") }
    );
    expect(failures).toEqual([
      "src/lib/new-move.ts#move: projectProfile.update writes organisationId — only setPersonOrganisation writes a person's organisation (D101)",
    ]);
  });

  it("a write of a profile with data it can't see, or by raw SQL, outside setPersonOrganisation", () => {
    const file = "src/lib/new-move.ts";
    const failures = failuresWith(
      file,
      `import type { Prisma } from "@prisma/client";
       export async function patch(tx: Prisma.TransactionClient, id: string, data: Prisma.ProjectProfileUpdateInput) {
         await tx.projectProfile.update({ where: { id }, data });
       }
       export async function rawMove(tx: Prisma.TransactionClient, id: string, org: string) {
         await tx.$executeRaw\`UPDATE "ProjectProfile" SET "organisationId" = \${org} WHERE id = \${id}\`;
       }`,
      { ...ALLOW, [`${file}#patch`]: system("a test entry"), [`${file}#rawMove`]: system("a test entry") }
    );
    expect(failures).toEqual([
      "src/lib/new-move.ts#patch: projectProfile.update writes organisationId — only setPersonOrganisation writes a person's organisation (D101)",
      "src/lib/new-move.ts#rawMove: raw SQL writes ProjectProfile.organisationId — only setPersonOrganisation writes a person's organisation (D101)",
    ]);
  });

  it("a new function in learner.ts keyed to an id from its arguments, even on the list", () => {
    const file = "src/app/actions/learner.ts";
    const failures = failuresWith(
      file,
      `export async function peekCompCard(forUser: string) {
         await requireLearner();
         return prisma.compCard.findUnique({ where: { userId_projectId: { userId: forUser, projectId: PROJECT } } });
       }`,
      { ...ALLOW, [`${file}#peekCompCard`]: own("a test entry") }
    );
    expect(failures).toEqual([
      "src/app/actions/learner.ts#peekCompCard: compCard.findUnique — userId isn't the signed-in person's id: forUser",
    ]);
  });

  it("and the same function keyed to the signed-in learner passes", () => {
    const file = "src/app/actions/learner.ts";
    const failures = failuresWith(
      file,
      `export async function ownCompCard() {
         const user = await requireLearner();
         return prisma.compCard.findUnique({ where: { userId_projectId: { userId: user.id, projectId: PROJECT } } });
       }`,
      { ...ALLOW, [`${file}#ownCompCard`]: own("a test entry") }
    );
    expect(failures).toEqual([]);
  });

  it("a staff function on the list that doesn't ask the scope module", () => {
    const file = "src/lib/server-queries.ts";
    const failures = failuresWith(
      file,
      `export async function everyCard() { return prisma.compCard.findMany({ where: { projectId: PROJECT } }); }`,
      { ...ALLOW, [`${file}#everyCard`]: staff("a test entry") }
    );
    expect(failures).toEqual([
      "src/lib/server-queries.ts#everyCard: compCard.findMany — a staff function that doesn't ask @/lib/scope",
    ]);
  });

  /** The sources with `code` put right after `anchor` in the real `file`. */
  const failuresInjected = (file: string, anchor: string, code: string, allow: AllowList = ALLOW) => {
    const text = SOURCES.get(file);
    if (!text?.includes(anchor)) throw new Error(`anchor missing in ${file}`);
    const sources = new Map(SOURCES);
    sources.set(file, text.replace(anchor, `${anchor}\n${code}\n`));
    return judge(sources, allow).failures;
  };
  const LEARNER = "src/app/actions/learner.ts";
  const IN_LOAD_GLOBAL = "export async function loadLearnerGlobal() {\n  const user = await requireLearner();";

  it("an own-data call that loads other people through its include", () => {
    expect(
      failuresInjected(
        LEARNER,
        IN_LOAD_GLOBAL,
        `await prisma.membership.findMany({ where: { userId: user.id }, include: { cohort: { include: { memberships: { include: { user: true } } } } } });`
      )
    ).toEqual([
      "src/app/actions/learner.ts#loadLearnerGlobal: membership.findMany loads cohort, memberships, user — beyond the signed-in person's own rows",
    ]);
    expect(
      failuresInjected(
        LEARNER,
        IN_LOAD_GLOBAL,
        `await prisma.courseEnrollment.findMany({ where: { userId: user.id }, select: { course: { select: { enrollments: { select: { user: true, responses: true } } } } } });`
      )
    ).toEqual([
      "src/app/actions/learner.ts#loadLearnerGlobal: courseEnrollment.findMany loads course, enrollments, user — beyond the signed-in person's own rows",
    ]);
    // A note about the learner names its author: another person.
    expect(
      failuresInjected(
        LEARNER,
        IN_LOAD_GLOBAL,
        `await prisma.user.findUnique({ where: { id: user.id }, include: { observedNotes: { include: { observer: true } } } });`
      )
    ).toEqual([
      "src/app/actions/learner.ts#loadLearnerGlobal: user.findUnique loads observedNotes, observer — beyond the signed-in person's own rows",
    ]);
  });

  it("an own-data call whose include it can't follow", () => {
    expect(
      failuresInjected(
        LEARNER,
        IN_LOAD_GLOBAL,
        `await prisma.membership.findMany({ where: { userId: user.id }, include: SOMETHING_ELSEWHERE });`
      )
    ).toEqual([
      "src/app/actions/learner.ts#loadLearnerGlobal: membership.findMany — loads an include or select the test can't follow",
    ]);
  });

  it("and an own-data call that loads the person's own rows and course content passes", () => {
    expect(
      failuresInjected(
        LEARNER,
        IN_LOAD_GLOBAL,
        `await prisma.membership.findMany({ where: { userId: user.id }, include: { cohort: true, user: { include: { compCards: { include: { entries: true } }, badges: { include: { badge: true } } } } } });
         await prisma.courseEnrollment.findMany({ where: { userId: user.id }, select: { course: { select: { slug: true } }, completedAt: true } });`
      )
    ).toEqual([]);
  });

  it("an own-data where that mentions the person but doesn't keep to them", () => {
    const cases: [string, string][] = [
      [`await prisma.compCard.findMany({ where: { NOT: { userId: user.id } } });`, "compCard.findMany — userId sits under NOT"],
      [
        `await prisma.courseEnrollment.findMany({ where: { OR: [{ userId: user.id }, { course: { projectId: PROJECT } }] } });`,
        "courseEnrollment.findMany — userId sits under OR",
      ],
      [
        `await prisma.compCard.findMany({ where: { project: { memberships: { some: { userId: user.id } } } } });`,
        "compCard.findMany — userId sits under project",
      ],
      [
        'await prisma.$queryRaw`SELECT * FROM "CompCard" WHERE "userId" <> ${user.id}`;',
        "$queryRaw — raw SQL on people's data not keyed to the signed-in person",
      ],
      [
        'await prisma.$queryRaw`SELECT * FROM "CompCard" WHERE "userId" = ${user.id} OR true`;',
        "$queryRaw — raw SQL on people's data not keyed to the signed-in person",
      ],
    ];
    for (const [code, failure] of cases) {
      expect(failuresInjected(LEARNER, IN_LOAD_GLOBAL, code), code).toEqual([
        `src/app/actions/learner.ts#loadLearnerGlobal: ${failure}`,
      ]);
    }
  });

  it("an own-data write keyed to a row's id the function didn't read as its own", () => {
    const failures = failuresWith(
      LEARNER,
      `export async function wipeCard(forUser: string) {
         await requireLearner();
         const card = await Promise.resolve({ id: forUser });
         return prisma.compCard.update({ where: { id: card.id }, data: { wentWell: "" } });
       }
       export async function wipeOtherCard(forUser: string) {
         await requireLearner();
         const card = await prisma.compCard.findFirst({ where: { userId: forUser } });
         return prisma.compCard.update({ where: { id: card!.id }, data: { wentWell: "" } });
       }`,
      { ...ALLOW, [`${LEARNER}#wipeCard`]: own("a test entry"), [`${LEARNER}#wipeOtherCard`]: own("a test entry") }
    );
    expect(failures).toEqual([
      "src/app/actions/learner.ts#wipeCard: compCard.update — not keyed to a person",
      "src/app/actions/learner.ts#wipeOtherCard: compCard.findFirst — userId isn't the signed-in person's id: forUser",
      "src/app/actions/learner.ts#wipeOtherCard: compCard.update — not keyed to a person",
    ]);
  });

  it("and an own-data write keyed to the id of the person's own row passes", () => {
    const failures = failuresWith(
      LEARNER,
      `export async function clearOwnCard() {
         const user = await requireLearner();
         const card = await prisma.compCard.findUnique({ where: { userId_projectId: { userId: user.id, projectId: PROJECT } } });
         if (card) await prisma.compCard.update({ where: { id: card.id }, data: { wentWell: "" } });
       }`,
      { ...ALLOW, [`${LEARNER}#clearOwnCard`]: own("a test entry") }
    );
    expect(failures).toEqual([]);
  });

  it("every read of the audit log, whatever it filters on", () => {
    const failures = failuresWith(
      "src/lib/new-activity.ts",
      `import { prisma } from "@/lib/prisma";
       export async function everyonesTime(projectId: string) {
         return prisma.auditLog.findMany({ where: { projectId, action: { in: ["stage.time", "video.cue_answered"] } }, select: { actorId: true, metadata: true } });
       }
       export async function grouped(projectId: string) {
         return prisma.auditLog.groupBy({ by: ["actorId"], where: { projectId }, _count: true });
       }`
    );
    expect(failures).toEqual([
      "src/lib/new-activity.ts#everyonesTime: auditLog.findMany — not on the allow-list",
      "src/lib/new-activity.ts#grouped: auditLog.groupBy — not on the allow-list",
    ]);
  });

  it("a person's organisation written into a data object after its declaration: by Object.assign or by a property", () => {
    const D101 = "only setPersonOrganisation writes a person's organisation (D101)";
    const PROFILE = "src/app/actions/profile.ts";
    expect(
      failuresInjected(PROFILE, "        Object.assign(data, {\n          country: value.country,", `          organisationId: "seq-elevate-synthesis",`)
    ).toEqual([`src/app/actions/profile.ts#completeProfile: projectProfile.update writes organisationId — ${D101}`]);
    expect(
      failuresInjected(PROFILE, "      const name = value.name;", `      data.organisationId = "seq-elevate-synthesis";`)
    ).toEqual([`src/app/actions/profile.ts#completeProfile: projectProfile.update writes organisationId — ${D101}`]);
    expect(
      failuresInjected(PROFILE, "      const name = value.name;", `      data["organisation"] = { connect: { id: "seq-elevate-synthesis" } };`)
    ).toEqual([`src/app/actions/profile.ts#completeProfile: projectProfile.update writes organisationId — ${D101}`]);
    // The control: what the profile step writes there today passes.
    expect(failuresInjected(PROFILE, "      const name = value.name;", "")).toEqual([]);
  });

  it("a person's organisation written through a relation, even on the list", () => {
    const D101 = "only setPersonOrganisation writes a person's organisation (D101)";
    // In a function already on the list (demo sign-in).
    expect(
      failuresInjected(
        "src/app/actions/demo.ts",
        `    const learner = roles.every((r) => r === "LEARNER");`,
        `    await tx.projectProfile.update({ where, data: { organisation: { connect: { id: "seq-elevate-synthesis" } } } });`
      )
    ).toEqual([`src/app/actions/demo.ts#completeDemoProfile: projectProfile.update writes organisation — ${D101}`]);
    // Through the learner's own user row, in an own-data function.
    expect(
      failuresInjected(
        LEARNER,
        IN_LOAD_GLOBAL,
        `await prisma.user.update({ where: { id: user.id }, data: { profiles: { update: { where: { userId_projectId: { userId: user.id, projectId: PROJECT } }, data: { organisationId: "seq-elevate-synthesis" } } } } });`
      )
    ).toEqual([`src/app/actions/learner.ts#loadLearnerGlobal: user.update writes profiles' organisation — ${D101}`]);
    // In a new file, put on the list.
    const file = "src/lib/new-move.ts";
    const failures = failuresWith(
      file,
      `import { prisma } from "@/lib/prisma";
       import type { Prisma } from "@prisma/client";
       export async function move(tx: Prisma.TransactionClient, userId: string, id: string) {
         await tx.projectProfile.update({ where: { userId_projectId: { userId, projectId: "seq-elevate" } }, data: { organisation: { connect: { id } } } });
       }
       export async function claim(id: string, profileId: string) {
         return prisma.organisation.update({ where: { id }, data: { profiles: { connect: { id: profileId } } } });
       }
       export async function invite(email: string, organisationId: string) {
         return prisma.user.create({ data: { email, profiles: { create: { projectId: "seq-elevate", organisationId } } } });
       }`,
      {
        ...ALLOW,
        [`${file}#move`]: system("a test entry"),
        [`${file}#claim`]: system("a test entry"),
        [`${file}#invite`]: system("a test entry"),
      }
    );
    expect(failures).toEqual([
      `src/lib/new-move.ts#move: projectProfile.update writes organisation — ${D101}`,
      `src/lib/new-move.ts#claim: organisation.update writes profiles — ${D101}`,
      `src/lib/new-move.ts#invite: user.create writes profiles' organisation — ${D101}`,
    ]);
  });

  it("people's data reached by a relation's own method, a nested write, a renamed delegate or a bracketed method", () => {
    const failures = failuresWith(
      "src/lib/new-shapes.ts",
      `import { prisma } from "@/lib/prisma";
       export async function people(id: string) { return prisma.organisation.findUnique({ where: { id } }).profiles(); }
       export async function members(id: string) { return prisma.cohort.findUnique({ where: { id } }).memberships({ include: { user: true } }); }
       export async function wipe(id: string) { return prisma.cohort.update({ where: { id }, data: { memberships: { deleteMany: {} } } }); }
       export async function renamed() { const cards = prisma.compCard; return cards.findMany({}); }
       export async function bracketed() { return prisma.compCard["findMany"]({}); }
       export async function destructured() { const { organisation } = prisma; return organisation.findMany({ include: { profiles: true } }); }`
    );
    expect(failures).toEqual([
      "src/lib/new-shapes.ts#people: organisation.findUnique().profiles — not on the allow-list",
      "src/lib/new-shapes.ts#members: cohort.findUnique().memberships loads user — not on the allow-list",
      "src/lib/new-shapes.ts#wipe: cohort.update writes memberships — not on the allow-list",
      "src/lib/new-shapes.ts#renamed: compCard.findMany — not on the allow-list",
      "src/lib/new-shapes.ts#bracketed: compCard.findMany — not on the allow-list",
      "src/lib/new-shapes.ts#destructured: organisation.findMany loads profiles — not on the allow-list",
    ]);
  });

  it("a staff function that names a builder it imported from somewhere else", () => {
    const failures = failuresWith(
      "src/lib/new-staff.ts",
      `import { prisma } from "@/lib/prisma";
       import { inScope } from "@/lib/not-the-scope-module";
       export async function cardOf(id: string) { if (!(await inScope({ kind: "none" }, id))) return null; return prisma.compCard.findFirst({ where: { userId: id } }); }`,
      { ...ALLOW, "src/lib/new-staff.ts#cardOf": staff("a test entry") }
    );
    expect(failures).toEqual(["src/lib/new-staff.ts#cardOf: compCard.findFirst — a staff function that doesn't ask @/lib/scope"]);
  });
});
