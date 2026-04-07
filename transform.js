/**
 * json-xslt — Lightweight declarative JSON transformation engine
 *
 * Usage:
 *   import { transform, prepareMapping } from './transform.js';
 *   import mapping from './my-mapping.js';
 *
 *   // Programmatic (automatic dictionary loading):
 *   const ready = await prepareMapping(mapping);
 *   const result = transform(sourceData, ready);
 *
 * Supports nested source paths ("address.city"), nested target blocks,
 * external dictionary loading, and forEach iteration.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── Path helpers ─────────────────────────────────────────────────────

/**
 * Resolve a dot-path on an object.
 *   resolvePath({ a: { b: 42 } }, "a.b")  →  42
 *   resolvePath({ a: { b: [10,20] } }, "a.b.1")  →  20
 *   resolvePath({ x: null }, "x.y")  →  undefined
 */
function resolvePath(obj, pathStr) {
  if (obj === null || obj === undefined) return undefined;
  const parts = pathStr.split(".");
  let cursor = obj;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

/**
 * Set a value at a dot-path, creating intermediate objects as needed.
 *   setPath({}, "a.b.c", 42)  →  { a: { b: { c: 42 } } }
 */
function setPath(obj, pathStr, value) {
  const parts = pathStr.split(".");
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = parts[i + 1];
    if (!cursor[key] || typeof cursor[key] !== "object") {
      cursor[key] = /^\d+$/.test(next) ? [] : {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

// ── Dictionary loader ────────────────────────────────────────────────

/**
 * Load and index dictionaries defined in a mapping.
 *
 * Supports two formats:
 *
 *   1. Inline:  { statusMap: { "A": "Active", ... } }
 *
 *   2. External: { employees: { $file: "./employees.json", indexBy: "id" } }
 *
 * $file paths are resolved relative to the mapping file's directory.
 * Returns a new mapping object with dictionaries resolved into lookup maps.
 *
 * @param {Object} mapping   — mapping definition (may be mutated)
 * @param {string} baseDir   — directory to resolve $file paths against
 * @returns {Promise<Object>} — mapping with loaded dictionaries
 */
export async function prepareMapping(mapping, baseDir = ".") {
  if (!mapping.dictionaries || typeof mapping.dictionaries !== "object") {
    return mapping;
  }

  const resolved = {};
  for (const [name, def] of Object.entries(mapping.dictionaries)) {
    if (def && typeof def === "object" && "$file" in def) {
      const filePath = resolve(baseDir, def.$file);
      let data;
      try {
        data = JSON.parse(readFileSync(filePath, "utf-8"));
      } catch (e) {
        throw new Error(`Failed to load dictionary "${name}" from ${filePath}: ${e.message}`);
      }

      if (def.indexBy) {
        // Build lookup map from array of objects
        if (!Array.isArray(data)) {
          throw new Error(`Dictionary "${name}": expected an array for indexBy "${def.indexBy}"`);
        }
        resolved[name] = {};
        for (const item of data) {
          const key = String(resolvePath(item, def.indexBy));
          resolved[name][key] = item;
        }
      } else {
        // Use as-is (must already be a key→value map)
        resolved[name] = data;
      }
    } else {
      // Inline dictionary — use as-is
      resolved[name] = def;
    }
  }

  return { ...mapping, dictionaries: resolved, __resolved: true };
}

/**
 * Synchronous alternative when all dictionaries are inline.
 * Throws if any dictionary uses $file (use prepareMapping instead).
 */
export function prepareMappingSync(mapping, baseDir = ".") {
  if (!mapping.dictionaries || typeof mapping.dictionaries !== "object") {
    return mapping;
  }
  for (const [name, def] of Object.entries(mapping.dictionaries)) {
    if (def && typeof def === "object" && "$file" in def) {
      throw new Error(
        `Dictionary "${name}" uses $file — use the async prepareMapping() instead of prepareMappingSync()`
      );
    }
  }
  return { ...mapping, dictionaries: mapping.dictionaries, __resolved: true };
}

// ── Date helpers ─────────────────────────────────────────────────────

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

  const sortedTokens = Object.keys(tokens)
    .filter(k => k.length > 0)
    .sort((a, b) => b.length - a.length);
  const pattern = new RegExp(sortedTokens.map(escapeRe).join("|"), "g");
  return outputFormat.replace(pattern, (match) => String(tokens[match]));
}

// ── Condition evaluation ─────────────────────────────────────────────

function evaluateCondition(sourceRow, condition) {
  if (condition.and) {
    return Array.isArray(condition.and) && condition.and.every(c => evaluateCondition(sourceRow, c));
  }
  if (condition.or) {
    return Array.isArray(condition.or) && condition.or.some(c => evaluateCondition(sourceRow, c));
  }
  if (condition.not) {
    return !evaluateCondition(sourceRow, condition.not);
  }

  const { field, op, value } = condition;
  const actual = field.includes(".")
    ? resolvePath(sourceRow, field)
    : sourceRow[field];

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

// ── Core transform ───────────────────────────────────────────────────

function transformField(sourceRow, fieldDef, dictionaries = {}) {
  // 0. Nested sub-mapping (recursive)
  if ("fields" in fieldDef && typeof fieldDef.fields === "object") {
    if (fieldDef.forEach !== undefined) {
      return transformForEach(sourceRow, fieldDef, dictionaries);
    }
    return transformOne(sourceRow, { fields: fieldDef.fields }, dictionaries);
  }

  // 1. forEach — array iteration
  if (fieldDef.forEach !== undefined) {
    return transformForEach(sourceRow, fieldDef, dictionaries);
  }

  // 2. Literal / static value
  if ("value" in fieldDef) return fieldDef.value;

  // 3. Conditional (if / then / else)
  if (fieldDef.if) {
    const passes = evaluateCondition(sourceRow, fieldDef.if);
    const result = passes ? fieldDef.then : fieldDef.else;
    if (passes && typeof fieldDef.thenMap === "object" && result !== undefined && result !== null) {
      return fieldDef.thenMap[result] ?? result;
    }
    if (!passes && typeof fieldDef.elseMap === "object" && result !== undefined && result !== null) {
      return fieldDef.elseMap[result] ?? result;
    }
    return result;
  }

  // 4. Custom compute function
  if (typeof fieldDef.compute === "function") {
    const fromPaths = Array.isArray(fieldDef.from) ? fieldDef.from : [fieldDef.from];
    const values = fromPaths.map(f => resolvePath(sourceRow, f));
    return fieldDef.compute(...values, sourceRow, dictionaries);
  }

  // 5. Field mapping (rename / map / format)
  const sourcePath = fieldDef.from;
  if (!sourcePath) return undefined;

  // Determine the lookup key (from source field or explicit lookupKey)
  let lookupKey = fieldDef.lookupKey
    ? resolvePath(sourceRow, fieldDef.lookupKey)
    : Array.isArray(sourcePath)
      ? sourcePath.map(p => resolvePath(sourceRow, p))
      : resolvePath(sourceRow, sourcePath);

  let result = lookupKey;

  // 5a. Dictionary lookup
  if (fieldDef.lookup) {
    const dict = dictionaries[fieldDef.lookup];
    if (dict !== undefined) {
      if (result !== undefined && result !== null) {
        const key = String(result);
        const entry = dict[key];
        // If lookupPath is set, drill into the dictionary entry
        if (fieldDef.lookupPath && entry !== undefined) {
          result = resolvePath(entry, fieldDef.lookupPath);
        } else {
          result = entry;
        }
      }
    }
  }

  // 5b. Default value fallback
  if (result === undefined || result === null) {
    result = fieldDef.default;
  }

  // 5c. Apply value map
  if (typeof fieldDef.map === "object" && result !== undefined && result !== null) {
    result = fieldDef.map[result] ?? result;
  }

  // 5d. Apply format (null-safe)
  if (fieldDef.format) {
    if (result === undefined || result === null) {
      return null;
    }
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

function transformForEach(sourceRow, fieldDef, dictionaries) {
  const sourceArray = resolvePath(sourceRow, fieldDef.forEach);
  if (!Array.isArray(sourceArray)) return [];

  const subMapping = { fields: fieldDef.fields };
  return sourceArray.map(item => transformOne(item, subMapping, dictionaries));
}

/**
 * Transform a single source object.
 */
export function transformOne(sourceRow, mapping, dictionaries = {}) {
  const dicts = mapping.dictionaries || dictionaries;
  const result = {};
  for (const [targetKey, fieldDef] of Object.entries(mapping.fields)) {
    const value = transformField(sourceRow, fieldDef, dicts);
    if (targetKey.includes(".")) {
      setPath(result, targetKey, value);
    } else {
      result[targetKey] = value;
    }
  }
  return result;
}

/**
 * Transform an array of source objects.
 */
export function transform(source, mapping, dictionaries = {}) {
  return source.map(row => transformOne(row, mapping, dictionaries));
}
