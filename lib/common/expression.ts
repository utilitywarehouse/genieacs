import { map, parseLikePattern } from "./expression-parser";
import { booleanCnf } from "./expression-cnf";
import { naiveDpll } from "./sat-solver";
import { Expression } from "../types";

const isArray = Array.isArray;

const regExpCache = new WeakMap();

const REDUCE_SKIP = {};
function reduce(exp, callback): Expression {
  let loop = true;
  while (loop) {
    loop = false;
    for (let i = 2; i < exp.length; ++i) {
      const res = callback(exp[i - 1], exp[i], i - 2);
      if (res !== REDUCE_SKIP) {
        loop = true;
        exp = exp.slice();
        exp.splice(i - 1, 2, res);
      }
    }
  }
  if (exp.length === 2) return exp[1];
  return exp;
}

export function likePatternToRegExp(pat, esc = "", flags = ""): RegExp {
  const convChars = {
    "-": "\\-",
    "/": "\\/",
    "\\": "\\/",
    "^": "\\^",
    $: "\\$",
    "*": "\\*",
    "+": "\\+",
    "?": "\\?",
    ".": "\\.",
    "(": "\\(",
    ")": "\\)",
    "|": "\\|",
    "[": "\\[",
    "]": "\\]",
    "{": "\\{",
    "}": "\\}",
    "\\%": ".*",
    "\\_": "."
  };
  let chars = parseLikePattern(pat, esc);
  if (!chars.length) return new RegExp("^$", flags);
  chars = chars.map(c => convChars[c] || c);
  chars[0] = chars[0] === ".*" ? "" : "^" + chars[0];
  const l = chars.length - 1;
  chars[l] = [".*", ""].includes(chars[l]) ? "" : chars[l] + "$";
  return new RegExp(chars.join(""), flags);
}

export function evaluate(
  exp,
  obj,
  now: number,
  cb?: Function
): string | number | boolean | null;
export function evaluate(exp, obj?, now?: number, cb?: Function): Expression;
export function evaluate(exp, obj?, now?: number, cb?: Function): Expression {
  function getRegExp(pat, esc): RegExp {
    const k = `${esc || ""}:${pat}`;
    let c = regExpCache.get(exp);
    if (!c) regExpCache.set(exp, (c = {}));
    if (!c[k]) c[k] = likePatternToRegExp(pat, esc);
    return c[k];
  }

  return map(exp, e => {
    if (cb) e = cb(e);
    if (!isArray(e)) return e;

    if (e[0] === "FUNC") {
      if (e[1] === "NOW") {
        if (now) return now;
      } else if (e[1] === "UPPER") {
        if (e[2] == null) return null;
        if (!isArray(e[2])) return `${e[2]}`.toUpperCase();
      } else if (e[1] === "LOWER") {
        if (e[2] == null) return null;
        if (!isArray(e[2])) return `${e[2]}`.toLowerCase();
      }
    } else if (e[0] === "PARAM") {
      if (e[1] == null) return null;
      if (obj && !isArray(e[1])) {
        let v = obj[e[1]];
        if (v == null) return null;
        if (typeof v === "object") v = v.value ? v.value[0] : null;
        return v;
      }
    } else if (e[0] === "AND") {
      return reduce(e, (a, b) => {
        if (!isArray(a)) return a ? b : a;
        if (!isArray(b)) return b ? a : b;
        return REDUCE_SKIP;
      });
    } else if (e[0] === "OR") {
      return reduce(e, (a, b) => {
        if (!isArray(a)) return a ? a : b;
        if (!isArray(b)) return b ? b : a;
        return REDUCE_SKIP;
      });
    } else if (e[0] === "NOT") {
      if (!isArray(e[1])) return !e[1];
      else if (e[1][0] === "NOT") return e[1][1];
    } else if (e[0] === "IS NULL") {
      if (isArray(e[1])) return e;
      else if (e[1] == null) return true;
      else return null;
    } else if (e[0] === "IS NOT NULL") {
      if (isArray(e[1])) return e;
      else if (e[1] != null) return true;
      else return null;
    } else if (e[0] === "LIKE") {
      if (isArray(e[1]) || isArray(e[2]) || isArray(e[3])) return e;
      else if (e[1] == null || e[2] == null || (e.length >= 4 && e[3] == null))
        return null;

      const r = getRegExp(e[2], e[3]);
      return r.test(e[1]);
    } else if (e[0] === "NOT LIKE") {
      if (isArray(e[1]) || isArray(e[2]) || isArray(e[3])) return e;
      else if (e[1] == null || e[2] == null || (e.length >= 4 && e[3] == null))
        return null;
      const r = getRegExp(e[2], e[3]);
      return !r.test(e[1]);
    } else if (e[0] === "=") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] === e[2];
    } else if (e[0] === "<>") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] !== e[2];
    } else if (e[0] === ">") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] > e[2];
    } else if (e[0] === ">=") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] >= e[2];
    } else if (e[0] === "<") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] < e[2];
    } else if (e[0] === "<=") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] <= e[2];
    } else if (e[0] === "*") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return a * b;
        }
        return REDUCE_SKIP;
      });
    } else if (e[0] === "/") {
      return reduce(e, (a, b, i) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return i === 0 ? a / b : a * b;
        }
        return REDUCE_SKIP;
      });
    } else if (e[0] === "+") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return a + b;
        }
        return REDUCE_SKIP;
      });
    } else if (e[0] === "-") {
      return reduce(e, (a, b, i) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return i === 0 ? a - b : a + b;
        }
        return REDUCE_SKIP;
      });
    } else if (e[0] === "||") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return `${a}${b}`;
        }
        return REDUCE_SKIP;
      });
    }
    return e;
  });
}

export function and(exp1, exp2): Expression {
  if (!isArray(exp1)) return exp1 ? exp2 : exp1;
  if (!isArray(exp2)) return exp2 ? exp1 : exp2;

  let res: Expression = ["AND"];

  if (exp1[0] === "AND") res = res.concat(exp1.slice(1));
  else res.push(exp1);

  if (exp2[0] === "AND") res = res.concat(exp2.slice(1));
  else res.push(exp2);

  return res;
}

export function or(exp1, exp2): Expression {
  if (!isArray(exp1)) return exp1 ? exp1 : exp2;
  if (!isArray(exp2)) return exp2 ? exp2 : exp1;

  let res: Expression = ["OR"];

  if (exp1[0] === "OR") res = res.concat(exp1.slice(1));
  else res.push(exp1);

  if (exp2[0] === "OR") res = res.concat(exp2.slice(1));
  else res.push(exp2);

  return res;
}

export function not(exp): Expression {
  if (isArray(exp) && exp[0] === "NOT") return exp[1];
  return ["NOT", exp];
}

export function subset(exp1, exp2): boolean {
  const e = evaluate(["NOT", ["OR", ["NOT", exp1], exp2]]);
  if (!isArray(e)) return !e;
  const { vars, clauses } = booleanCnf(e);
  return !naiveDpll(clauses, vars);
}

export function extractParams(exp): string[] {
  const params = new Set();
  map(exp, e => {
    if (isArray(e) && e[0] === "PARAM") params.add(e[1]);
    return e;
  });
  return Array.from(params);
}
