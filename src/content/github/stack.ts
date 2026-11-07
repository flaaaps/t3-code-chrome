import type { PrStack } from "@shared/models";
import type { PrKey } from "@shared/prKey";
import { extractEmbeddedData } from "@shared/pulls";
import { parsePrStack } from "@shared/stack";

const EMBEDDED = 'script[data-target="react-app.embeddedData"]';
/** GitHub's stack navigator in the PR header ("1/2"), new PR experience only. */
const STACK_BADGE = "button[class*='stackBadge'], [aria-label^='Navigate pull request stack']";

/**
 * The stack from the page's embedded data. `null`: the PR is in no stack. `undefined`: the data
 * describes another page (it stays from the first load across soft navigations) or is missing.
 */
export function stackFromPage(pr: PrKey): PrStack | null | undefined {
  const payloads: unknown[] = [];
  for (const node of document.querySelectorAll(EMBEDDED)) {
    const text = node.textContent ?? "";
    if (!text.includes('"pullRequestsLayoutRoute"')) continue;
    try {
      payloads.push(JSON.parse(text));
    } catch {
      // ignore broken payloads
    }
  }
  return parsePrStack(payloads, pr.number);
}

/** Whether the page shows GitHub's stack navigator, i.e. fetching the stack is worth a request. */
export function hasStackBadge(): boolean {
  return document.querySelector(STACK_BADGE) !== null;
}

/** The stack from a fresh copy of the PR page; undefined when it has none or the fetch fails. */
export async function fetchStack(pr: PrKey): Promise<PrStack | undefined> {
  try {
    const response = await fetch(`${window.location.origin}/${pr.owner}/${pr.repo}/pull/${pr.number}`, {
      credentials: "same-origin",
      headers: { accept: "text/html" },
    });
    if (!response.ok) return undefined;
    return parsePrStack(extractEmbeddedData(await response.text()), pr.number) ?? undefined;
  } catch {
    return undefined;
  }
}
