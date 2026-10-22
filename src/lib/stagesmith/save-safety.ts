/** True only when the polled signature differs from the latest acknowledged write. */
export function isExternalSignature(candidate: string, acknowledged: string): boolean {
  return candidate !== acknowledged;
}

/** Empty overwrites of non-empty files require an explicit user confirmation. */
export function mayWriteContent(previous: string, next: string, confirmedEmptyOverwrite = false): boolean {
  return next !== "" || previous === "" || confirmedEmptyOverwrite;
}
