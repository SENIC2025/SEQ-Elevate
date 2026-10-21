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
 *     missionProgress, session, user, projectProfile, staffHistory), and
 *     auditLog calls that filter on actorId or entityId;
 *   - a call on ANY model whose include or select names, at any depth, a
 *     relation that leads to people's data (memberships, enrollments,
 *     profiles, user, …), constants of the same file followed; an include
 *     or select the test can't follow counts too;
 *   - every $queryRaw, $queryRawUnsafe, $executeRaw, $executeRawUnsafe.
 *
 * A call is recognised by its shape, `<any client>.<model>.<method>(…)`,
 * whatever the client is called (prisma, tx, db, …); the model must be one
 * of schema.prisma's.
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
 *           the file fills with it); an id taken from the function's
 *           arguments fails;
 *   system  counts and system paths, each with its reason.
 *
 * A new hit anywhere fails until someone adds it with a reason, and an
 * entry nothing matches any more fails too. Writes to
 * ProjectProfile.organisationId are allowed only in setPersonOrganisation
 * (D101). Complements src/app/actions/use-server-exports.test.ts.
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

/** The Prisma models of schema.prisma, as their client delegates are named. */
const MODELS = new Set(
  [...readFileSync(`${ROOT}prisma/schema.prisma`, "utf8").matchAll(/^model (\w+) \{/gm)].map(
    (m) => m[1][0].toLowerCase() + m[1].slice(1)
  )
);

type Kind = "read" | "write" | "raw" | "relation" | "audit" | "unresolved" | "organisation-write";

interface Hit {
  file: string;
  fn: string;
  kind: Kind;
  what: string;
  call: ts.CallExpression | ts.TaggedTemplateExpression;
  model: string | null;
  method: string;
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

/**
 * The object literals an expression can be, following identifiers to
 * same-file constants, calls of same-file functions to what they return,
 * both arms of a condition, and spreads. Null when some part can't be
 * followed (a parameter, an import, a call to elsewhere).
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
      return objectsOf(d.initializer, seen);
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

/** Every property name under an include or select of `arg`, and whether all of it could be followed. */
function loadedRelations(arg: ts.Expression): { names: Set<string>; followed: boolean } {
  const names = new Set<string>();
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
  return { names, followed };
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

function scanSource(file: string, text: string): { hits: Hit[]; sf: ts.SourceFile } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const add = (call: Hit["call"], kind: Kind, model: string | null, method: string, what: string) =>
    hits.push({ file, fn: nameOf(call), kind, what, call, model, method });

  const visit = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node) && ts.isPropertyAccessExpression(node.tag) && RAW.has(node.tag.name.text)) {
      add(node, "raw", null, node.tag.name.text, node.tag.name.text);
      if (/(UPDATE|INSERT\s+INTO)\s+"ProjectProfile"[\s\S]*"organisationId"/i.test(node.template.getText())) {
        add(node, "organisation-write", "projectProfile", node.tag.name.text, `raw SQL writes ProjectProfile.organisationId`);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const target = node.expression.expression;
      // The model a call is on: `client.model`, `client["model"]`, or a
      // delegate taken out of the client (`const { compCard } = prisma`).
      const modelOf = (t: ts.Expression): string | null | "dynamic" => {
        if (ts.isPropertyAccessExpression(t)) return MODELS.has(t.name.text) ? t.name.text : null;
        if (ts.isElementAccessExpression(t)) {
          const k = t.argumentExpression;
          if (ts.isStringLiteralLike(k)) return MODELS.has(k.text) ? k.text : null;
          return "dynamic";
        }
        if (ts.isIdentifier(t)) return LEARNER_MODELS.has(t.text) ? t.text : null;
        return null;
      };
      const found = READS.has(method) || WRITES.has(method) ? modelOf(target) : null;
      if (RAW.has(method)) add(node, "raw", null, method, method);
      else if (found === "dynamic") add(node, "unresolved", null, method, `<a model chosen at run time>.${method}`);
      else if (found) {
        const model = found;
        const arg = node.arguments[0];
        const loads = arg ? loadedRelations(arg) : { names: new Set<string>(), followed: true };
        const relations = [...loads.names].filter((n) => LEARNER_RELATIONS.has(n));
        if (model === "projectProfile" && WRITES.has(method)) {
          // Fails closed: data the test can't see may hold the organisation.
          const written = ["data", "create", "update"].some((k) => {
            const v = argumentProperty(node, k);
            const found = v ? propertiesNamed(v, new Set(["organisationId"])) : null;
            return !!found && (found.length > 0 || !!found.unfollowed);
          });
          if (written) add(node, "organisation-write", model, method, `${model}.${method} writes organisationId`);
        }
        if (LEARNER_MODELS.has(model)) add(node, READS.has(method) ? "read" : "write", model, method, `${model}.${method}`);
        else if (relations.length) add(node, "relation", model, method, `${model}.${method} loads ${relations.join(", ")}`);
        else if (!loads.followed) add(node, "unresolved", model, method, `${model}.${method} (an include or select the test can't follow)`);
        else if (model === "auditLog") {
          const where = argumentProperty(node, "where");
          if (where && propertiesNamed(where, new Set(["actorId", "entityId"])).length) {
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

  /** Is `e` the id of a row this function read (`row.id` of `const row = await …`)? */
  isRowId(e: ts.Expression): boolean {
    const u = unwrap(e);
    if (!ts.isPropertyAccessExpression(u) || u.name.text !== "id") return false;
    const obj = unwrap(u.expression);
    if (!ts.isIdentifier(obj)) return false;
    const d = declarationOf(obj.text, obj);
    return !!d && ts.isVariableDeclaration(d) && !!d.initializer && ts.isAwaitExpression(d.initializer);
  }
}

/** Is an own-data call keyed to the signed-in person (spec 3.6 group 2)? Null when it is; else why not. */
function ownDataProblem(hit: Hit, facts: FileFacts): string | null {
  if (hit.kind === "raw") {
    const call = hit.call;
    const template = ts.isTaggedTemplateExpression(call) ? call.template : null;
    if (!template) return "raw SQL by string in an own-data function";
    if (!LEARNER_TABLES.test(template.getText())) return null;
    const values = ts.isTemplateExpression(template) ? template.templateSpans.map((s) => s.expression) : [];
    return values.some((v) => facts.isSessionId(v)) ? null : "raw SQL on people's data not keyed to the signed-in person";
  }
  const call = hit.call as ts.CallExpression;
  const keyed = CREATES.has(hit.method) ? argumentProperty(call, "data") : argumentProperty(call, "where");
  if (!keyed) return "no where (or data) to key it to the signed-in person";
  const personKeys = new Set(["userId", "actorId", ...(hit.model === "user" ? ["id"] : [])]);
  const keys = propertiesNamed(keyed, personKeys);
  if (keys.unfollowed) return "keyed by something the test can't follow";
  if (!keys.length) {
    const ids = propertiesNamed(keyed, new Set(["id"]));
    if (hit.model !== "user" && ids.length && ids.every((k) => facts.isRowId(k.value))) return null;
    return "not keyed to a person";
  }
  const stray = keys.find((k) => !facts.isSessionId(k.value));
  return stray ? `${stray.key} isn't the signed-in person's id: ${stray.value.getText()}` : null;
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
        if (problem) failures.push(`${where} — ${problem}`);
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
  "src/app/actions/facilitator.ts#requireStaffFor": staff("who a note or validation may be about (SP6, SP7)"),
  "src/app/actions/facilitator.ts#saveObservation": staff("a facilitator's note (SP6)"),
  "src/app/actions/facilitator.ts#recordValidation": staff("a facilitator's validation (SP7)"),

  // ---- 2. A person's own data: keyed to the signed-in person ----
  "src/lib/server-queries.ts#getLearnerEnrollments": own("the dashboard's own enrolments (SP37)"),
  "src/app/actions/learner.ts#loadLearnerGlobal": own("the learner's own card, badges and enrolments (SP37)"),
  "src/app/actions/learner.ts#loadCourseProgress": own("the learner's own progress in a course (SP37)"),
  "src/app/actions/learner.ts#saveProgress": own("the learner's own progress save (SP37)"),
  "src/app/actions/learner.ts#lockRow": own("locks the learner's own enrolment row in a save (SP37)"),
  "src/app/actions/learner.ts#saveCompCard": own("the learner's own Comp Card (SP37)"),
  "src/app/actions/learner.ts#awardBadgeAction": own("the learner's own badge (SP37)"),
  "src/app/actions/telemetry.ts#recordStageTime": own("the learner's own time on a lesson (SP37)"),
  "src/app/actions/video.ts#recordVideoCueAnswer": own("the learner's own video answer (SP37)"),
  "src/app/actions/a11y.ts#saveA11yPrefs": own("the person's own reading-help settings (SP37)"),
  "src/app/actions/gdpr.ts#deleteMyAccount": own("the person's own account, deleted (SP28)"),
  "src/app/[locale]/account/page.tsx#Page": own("the account page's own figures (SP37)"),
  "src/app/[locale]/learner/course/[courseId]/page.tsx#resumeFor": own("where the learner resumes their own course (SP37)"),

  // ---- 3. Counts and system paths ----
  "src/lib/auth-helpers.ts#getCurrentUser": system("the signed-in person's own row, by the session's id"),
  "src/lib/auth-helpers.ts#load": system("the signed-in person's own memberships (getMemberships), by the session's id"),
  "src/lib/role-grants.ts#ensureProjectRoles": system("grants roles at sign-in to ADMIN_EMAILS and demo profiles (auth.ts) and on page load (auth-helpers.ts)"),
  "src/lib/scope.ts#getViewer": system("the scope module reads the viewer's own profile"),
  "src/lib/scope.ts#inScope": system("the scope module's own count (peopleInScope)"),
  "src/lib/person-organisation.ts#setPersonOrganisation": system("the one writer of a person's organisation (D101); called only by guarded actions and the profile step"),
  "src/lib/gdpr-export.ts#collectUserData": system("a person's data export: the session's own id (/api/me/export, SP27)"),
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
  "src/app/actions/lesson.ts#lockLesson": system("locks a lesson row for an editor's change (no people's data)"),
  "src/app/actions/structure.ts#writeIfUnchanged": system("an editor's structure change under a row lock (no people's data)"),
};

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
});

/*
 * The meta-test: changes that must fail. Each adds a file (or a function to
 * a real file) to the real sources and judges them with the real list.
 */
describe("the scope guard refuses (FD-U15 meta-test)", () => {
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
