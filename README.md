# json-xslt

A lightweight, **declarative JSON transformation engine** inspired by XSLT. Define mapping rules as plain JavaScript objects stored in reusable `.js` files, then pass them to a tiny `transform()` function.

## Why?

Sometimes you need to morph API responses, migrate data between schemas, or normalize external feeds — and a heavy ETL tool is overkill. `json-xslt` gives you a **stylesheet-like mapping definition** that is:

- **Readable** — each target field describes exactly where it comes from
- **Reusable** — export mappings as modules, share them, compose them
- **Extensible** — drop in a `compute()` function when built-in ops aren't enough

## Install

```bash
# No dependencies — just copy the files
git clone <this-repo>
cd json-xslt
```

## Quick start

```javascript
import { transform } from "./transform.js";
import myMapping  from "./my-mapping.js";

const output = transform(inputArray, myMapping);
```

## Mapping definition

Every mapping is a plain JS object with a `fields` dictionary:

```javascript
export default {
  id: "my-migration",
  fields: {
    targetFieldName: { /* fieldDef */ },
  },
};
```

### Field definition options

| Feature | Property | Example |
|---|---|---|
| **Rename** | `from` | `{ from: "OldName" }` |
| **Value map** | `map` | `{ from: "Code", map: { "A": "active", "I": "inactive" } }` |
| **Format date** | `format`, `outputFormat` | `{ from: "Date", format: "date", outputFormat: "YYYY-MM-DD" }` |
| **Format text** | `format` | `{ from: "Name", format: "uppercase" }` (also: `lowercase`, `trim`, `number`, `string`, `boolean`, `negate`) |
| **If / then** | `if`, `then`, `else` | See condition reference below |
| **Compute** | `from` (array), `compute` | `{ from: ["First","Last"], compute: (f,l) => f + " " + l }` |
| **Literal** | `value` | `{ value: "constant" }` |

### Condition operators

| Op | Meaning |
|---|---|
| `eq`, `neq` | Equal / not equal (loose) |
| `gt`, `gte`, `lt`, `lte` | Numeric comparison |
| `in`, `not-in` | Value in / not in array |
| `exists` | Field is present and non-null |
| `matches` | Regex match against string |
| `truthy`, `falsy` | Boolean coercion |

```javascript
{ if: { field: "Status", op: "gte", value: 5 }, then: "pass", else: "fail" }
```

### Composite conditions: `and` / `or` / `not`

Conditions can be composed together for complex logic. Nest them as deeply as needed.

**All must match (`and`)**

```javascript
bonus_eligible: {
  if: {
    and: [
      { field: "Status",       op: "eq",   value: "active" },
      { field: "YearsEmployed", op: "gt",   value: 1 },
      { field: "Salary",        op: "gte",  value: 50000 },
    ],
  },
  then: true,
  else: false,
}
```

**Any can match (`or`)**

```javascript
remote_ok: {
  if: {
    or: [
      { field: "Department",  op: "eq",        value: "Engineering" },
      { field: "Department",  op: "eq",        value: "Management" },
      { field: "Title",       op: "matches",   value: "(?i)(director|vp|chief)" },
    ],
  },
  then: true,
  else: false,
}
```

**Invert a condition (`not`)**

```javascript
needs_review: {
  if: { not: { field: "Status", op: "eq", value: "active" } },
  then: true,
  else: false,
}
```

**Deeply nested — real-world example**

```javascript
// Senior IC if (Engineering OR Data) AND (senior OR staff) AND NOT contractor
senior_ic: {
  if: {
    and: [
      {
        or: [
          { field: "Department", op: "eq", value: "Engineering" },
          { field: "Department", op: "eq", value: "Data" },
        ],
      },
      {
        or: [
          { field: "Level", op: "eq", value: "senior" },
          { field: "Level", op: "eq", value: "staff" },
          { field: "Level", op: "eq", value: "principal" },
        ],
      },
      { field: "EmployeeType", op: "neq", value: "contractor" },
    ],
  },
  then: true,
  else: false,
}
```

## API

```typescript
function transform(source: Array<Object>, mapping: Mapping): Array<Object>
function transformOne(sourceRow: Object, mapping: Mapping): Object
```

## File structure

```
json-xslt/
├── transform.js            # Core engine (import this)
├── mapping-crm-example.js  # Example: CRM migration
├── mapping-employee.js     # Example: employee import
├── demo.js                 # Runnable demo: node demo.js
└── README.md
```

## Limitations (v1)

- Source JSON must be an **array of flat objects** (no nested paths)
- Value maps are **exact-match only** (no regex keys)
- No `for-each` aggregation or cross-row computations
- `compute` functions must be plain JavaScript (not JSON-serializable)

## Future ideas

- Nested field paths (`"address.city"`)
- Multiple condition chains (`if/else if/else if/else`)
- CLI mode: `node transform.js --mapping map.js --input in.json --output out.json`
- JSON-based mapping format (separate from JS)
- TypeScript declarations
