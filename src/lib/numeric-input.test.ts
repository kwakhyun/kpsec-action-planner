import assert from "node:assert/strict";
import test from "node:test";

import {
  formatWholeNumberInput,
  normalizeWholeNumberInput,
  parseWholeNumberInput,
} from "./numeric-input";

test("whole-number input formats Korean won amounts without changing the value", () => {
  assert.equal(formatWholeNumberInput(10_000_000), "10,000,000");
  assert.equal(formatWholeNumberInput("123456789"), "123,456,789");
  assert.equal(parseWholeNumberInput("123,456,789"), 123_456_789);
});

test("whole-number input accepts pasted separators and preserves an empty field", () => {
  assert.equal(normalizeWholeNumberInput("₩ 01,234,500원"), "1234500");
  assert.equal(parseWholeNumberInput(""), null);
  assert.equal(formatWholeNumberInput(null), "");
});
