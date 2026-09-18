import type { DatabaseSync } from "node:sqlite";
import { lookupCustomer } from "./customer-directory.js";

/** Return no roster or candidate names on a failed phone/member match. */
export function verifiedMemberCode(db: DatabaseSync, member: unknown, phone: unknown): string {
  if (typeof member !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(member.trim())) throw new Error("MEMBER_VERIFICATION_FAILED");
  try {
    const matches = lookupCustomer(db, phone).customers;
    if (matches.length === 1 && matches[0].id.toUpperCase() === member.trim().toUpperCase()) return matches[0].id;
  } catch { /* The caller receives the same response for all identity failures. */ }
  throw new Error("MEMBER_VERIFICATION_FAILED");
}
