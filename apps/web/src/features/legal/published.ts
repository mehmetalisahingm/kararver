import { activateLegalBundle, type LegalBundle } from "./model";

// #285 has not supplied an approved public package. Never fill this with sample
// operator details, draft legal prose or a developer's personal contact address.
const approvedBundle: LegalBundle | null = null;

export function publishedLegalBundle() {
  return activateLegalBundle(approvedBundle);
}
