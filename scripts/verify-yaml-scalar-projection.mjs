import assert from "node:assert/strict";
import { isScalar, parseDocument } from "yaml";

const plainSafe = /^[A-Za-z0-9+][A-Za-z0-9 _.,\/+@()&=-]*$/;
const plainReserved = /^(?:true|false|null|~|yes|no|on|off|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/i;

function renderScalar(node, value) {
  assert.equal(typeof value, "string", "replacement must be a string");
  assert.equal(/[\u0000-\u001f\u007f]/u.test(value), false, "replacement contains a control character");
  if (node.type === "QUOTE_DOUBLE") return JSON.stringify(value);
  if (node.type === "QUOTE_SINGLE") return `'${value.replaceAll("'", "''")}'`;
  assert.equal(node.type, "PLAIN", "unsupported scalar style");
  return value.length > 0 && value.trim() === value && plainSafe.test(value) && !plainReserved.test(value)
    ? value
    : JSON.stringify(value);
}

/** Verify the source-range projection used by the governed publisher. A whole
 * document stringify normalizes unrelated YAML (including flow-array spacing)
 * and cannot establish whether a candidate changed only its permitted scalars.
 */
export function assertYamlScalarProjection(before, after, writes, label) {
  const document = parseDocument(before, { strict: true, uniqueKeys: true });
  assert.deepEqual(document.errors, [], `${label} base YAML is invalid`);
  document.toJS({ maxAliasCount: 0 });
  assert.ok(writes.length > 0, `${label} has no scalar writes`);
  const splices = writes.map(({ parts, value }) => {
    const node = document.getIn(parts, true);
    assert.ok(isScalar(node) && typeof node.value === "string", `${label} target is not a string scalar`);
    assert.ok(node.range && Number.isSafeInteger(node.range[0]) && Number.isSafeInteger(node.range[1])
      && node.range[0] >= 0 && node.range[1] > node.range[0] && node.range[1] <= before.length,
    `${label} scalar has no valid source range`);
    return { start: node.range[0], end: node.range[1], text: renderScalar(node, value) };
  }).sort((left, right) => left.start - right.start);
  for (let index = 1; index < splices.length; index += 1) {
    assert.ok(splices[index].start >= splices[index - 1].end, `${label} scalar writes overlap`);
  }
  let expected = before;
  for (const splice of splices.toReversed()) {
    expected = expected.slice(0, splice.start) + splice.text + expected.slice(splice.end);
  }
  assert.equal(after, expected, `${label} contains bytes outside its exact scalar projection`);
  const result = parseDocument(after, { strict: true, uniqueKeys: true });
  assert.deepEqual(result.errors, [], `${label} candidate YAML is invalid`);
  result.toJS({ maxAliasCount: 0 });
  for (const { parts, value } of writes) {
    assert.equal(result.getIn(parts), value, `${label} replacement does not read back`);
  }
}
