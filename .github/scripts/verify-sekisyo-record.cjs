"use strict";

const fs = require("node:fs");

const START_MARKER = "<!-- sekisyo:start:v1 -->";
const END_MARKER = "<!-- sekisyo:end -->";
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const HEAD_LINE_PATTERN =
  /^\*\*対象HEAD:\*\* `([0-9a-f]{40}|[0-9a-f]{64})`\r?$/gmu;
const START_LINE_PATTERN = /^<!-- sekisyo:start:v1 -->\r?$/gmu;
const END_LINE_PATTERN = /^<!-- sekisyo:end -->\r?$/gmu;

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function standaloneMatches(value, pattern) {
  return [...value.matchAll(pattern)];
}

function requireSingleStandaloneMarker(body, marker, pattern, label) {
  if (countOccurrences(body, marker) !== 1) {
    throw new Error(
      `Expected exactly one Sekisyo ${label} marker in the PR body.`
    );
  }
  const matches = standaloneMatches(body, pattern);
  if (matches.length !== 1) {
    throw new Error(
      `The Sekisyo ${label} marker must be on a standalone line.`
    );
  }
  return matches[0];
}

function verifySekisyoRecord(body, expectedHead) {
  if (typeof body !== "string") {
    throw new Error("The pull request body is unavailable.");
  }
  if (
    typeof expectedHead !== "string" ||
    !GIT_OBJECT_ID_PATTERN.test(expectedHead)
  ) {
    throw new Error("The pull request head SHA is unavailable or invalid.");
  }

  const startMatch = requireSingleStandaloneMarker(
    body,
    START_MARKER,
    START_LINE_PATTERN,
    "START"
  );
  const endMatch = requireSingleStandaloneMarker(
    body,
    END_MARKER,
    END_LINE_PATTERN,
    "END"
  );
  const startIndex = startMatch.index;
  const endIndex = endMatch.index;
  if (
    typeof startIndex !== "number" ||
    typeof endIndex !== "number" ||
    startIndex >= endIndex
  ) {
    throw new Error("Sekisyo record markers are out of order.");
  }

  const blockBody = body.slice(startIndex + startMatch[0].length, endIndex);
  const headLines = standaloneMatches(blockBody, HEAD_LINE_PATTERN);
  if (headLines.length !== 1) {
    throw new Error(
      "Expected exactly one target HEAD line inside the Sekisyo record block."
    );
  }
  const recordedHead = headLines[0][1];
  if (
    typeof recordedHead !== "string" ||
    recordedHead.toLowerCase() !== expectedHead.toLowerCase()
  ) {
    throw new Error(
      "The target HEAD inside the Sekisyo record does not match the current PR head."
    );
  }
}

function verifyEventFile(eventPath) {
  if (typeof eventPath !== "string" || eventPath.length === 0) {
    throw new Error("EVENT_PATH is required.");
  }
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  verifySekisyoRecord(event.pull_request?.body, event.pull_request?.head?.sha);
}

if (require.main === module) {
  verifyEventFile(process.env.EVENT_PATH);
}

module.exports = { verifyEventFile, verifySekisyoRecord };
