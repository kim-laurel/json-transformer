/**
 * json-xslt — Lightweight declarative JSON transformation engine
 *
 * Usage:
 *   import { transform } from './transform.js';
 *   import mapping from './my-mapping.js';
 *   const result = transform(sourceData, mapping);
 *
 * The mapping is a plain JavaScript object (or module export)
 * that declaratively describes field-by-field transformations —
 * much like an XSLT stylesheet, but for JSON.
 */

// ── Date helpers ──────────────────────────────────────────────────

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDate(dateValue, outputFormat) {
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return dateValue;

  const pad2 = (n) => String(n).padStart(2, "0");
  const YYYY = d.getFullYear();
  const MM   = pad2(d.getMonth() + 1);
  const DD   = pad2(d.getDate());
  const HH   = pad2(d.getHours());
  const mm   = pad2(d.getMinutes());
  const ss   = pad2(d.getSeconds());

  const monthName = MONTHS[d.getMonth()];
  const monthShort = monthName.slice(0, 3);

  const tokens = {
    "YYYY": String(YYYY), "YY": String(YYYY).slice(-2),
    "MM": MM, "M": String(d.getMonth() + 1),
    "DD": DD, "D": String(d.getDate()),
    "HH": HH, "H": String(d.getHours()),
    "hh": pad2(d.getHours() % 12 || 12),
    "mm": mm, "m": String(d.getMinutes()),
    "ss": ss, "s": String(d.getSeconds()),
    "MMMM": monthName, "MMM": monthShort,
    "AMPM": d.getHours() >= 12 ? "PM" : "AM",
  };

  // Single regex pass to avoid substring overlap (MM matching before MMMM, etc.)
  const sortedTokens = Object.keys(tokens)
    .filter(k => k.length > 0)
    .sort((a, b) => b.length - a.length);
  const pattern = new RegExp(sortedTokens.map(escapeRe).join("|"), "g");
  return outputFormat.replace(pattern, (match) => String(tokens[match]));
}

// ── Condition evaluation ──────────────────────────────────────────

function evaluateCondition(sourceRow, condition) {
  // ── Composable logic ────────────────────────────────────────────
  if (condition.and) {
    return Array.isArray(condition.and) && condition.and.every(c => evaluateCondition(sourceRow, c));
  }
  if (condition.or) {
    return Array.isArray(condition.or) && condition.or.some(c => evaluateCondition(sourceRow, c));
  }
  if (condition.not) {
    return !evaluateCondition(sourceRow, condition.not);
  }

  // ── Leaf condition ──────────────────────────────────────────────
  const { field, op, value } = condition;
  const actual = sourceRow[field];

  switch (op) {
    case "eq":      return actual == value;
    case "neq":     return actual != value;
    case "gte":     return actual >= value;
    case "lte":     return actual <= value;
    case "gt":      return actual > value;
    case "lt":      return actual < value;
    case "in":      return Array.isArray(value) ? value.includes(actual) : false;
    case "not-in":  return Array.isArray(value) ? !value.includes(actual) : true;
    case "exists":  return value
      ? (actual !== undefined && actual !== null)
      : (actual === undefined || actual === null);
    case "matches": try { return new RegExp(value).test(String(actual)); } catch { return false; }
    case "truthy":  return !!actual;
    case "falsy":   return !actual;
    default:        return false;
  }
}

// ── Core transform ────────────────────────────────────────────────

function transformField(sourceRow, targetKey, fieldDef) {
  // 1. Literal/static value
  if ("value" in fieldDef) return fieldDef.value;

  // 2. Conditional (if / then / else)
  if (fieldDef.if) {
    const passes = evaluateCondition(sourceRow, fieldDef.if);
    const result = passes ? fieldDef.then : fieldDef.else;
    // Support post-condition mapping
    if (passes && typeof fieldDef.thenMap === "object" && result !== undefined && result !== null) {
      return fieldDef.thenMap[result] ?? result;
    }
    if (!passes && typeof fieldDef.elseMap === "object" && result !== undefined && result !== null) {
      return fieldDef.elseMap[result] ?? result;
    }
    return result;
  }

  // 3. Custom compute function
  if (typeof fieldDef.compute === "function") {
    const fromFields = Array.isArray(fieldDef.from) ? fieldDef.from : [fieldDef.from];
    const values = fromFields.map(f => sourceRow[f]);
    return fieldDef.compute(...values, sourceRow);
  }

  // 4. Field mapping (rename / map / format)
  const sourceField = fieldDef.from;
  if (!sourceField) return undefined;

  const rawValue = Array.isArray(sourceField)
    ? sourceField.map(f => sourceRow[f])
    : sourceRow[sourceField];

  let result = rawValue;

  // Apply value map
  if (typeof fieldDef.map === "object" && result !== undefined && result !== null) {
    result = fieldDef.map[result] ?? result;
  }

  // Apply format
  if (fieldDef.format) {
    switch (fieldDef.format) {
      case "date":
        result = formatDate(result, fieldDef.outputFormat || "YYYY-MM-DD");
        break;
      case "lowercase":
        result = String(result).toLowerCase();
        break;
      case "uppercase":
        result = String(result).toUpperCase();
        break;
      case "trim":
        result = String(result).trim();
        break;
      case "number":
        result = Number(result);
        break;
      case "string":
        result = String(result);
        break;
      case "boolean":
        result = Boolean(result);
        break;
      case "negate":
        result = !result;
        break;
      default:
        break;
    }
  }

  return result;
}

/**
 * Transform a single source object.
 * @param {Object} sourceRow  — input JSON object
 * @param {Object} mapping    — { id?: string, fields: { <target>: fieldDef, ... } }
 * @returns {Object}          — transformed object
 */
export function transformOne(sourceRow, mapping) {
  const result = {};
  for (const [targetKey, fieldDef] of Object.entries(mapping.fields)) {
    result[targetKey] = transformField(sourceRow, targetKey, fieldDef);
  }
  return result;
}

/**
 * Transform an array of source objects.
 * @param {Array<Object>} source  — input JSON array
 * @param {Object} mapping        — mapping definition
 * @returns {Array<Object>}       — transformed array
 */
export function transform(source, mapping) {
  return source.map(row => transformOne(row, mapping));
}
