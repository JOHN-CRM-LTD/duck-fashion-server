import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { seedBonus } from "./bonus-seed.js";
import { verifiedMemberCode } from "./member-verification.js";

test("member identity requires the exact registered full phone and member ID", () => {
  const db = new DatabaseSync(":memory:");
  try {
    seedBonus(db);
    assert.equal(verifiedMemberCode(db, "df1005", "+852 (6123) 4505"), "DF1005");
    for (const [member, phone] of [["DF1005", undefined], ["DF1005", "61234505"], ["DF1005", "+85261234591"],
      ["DF1005", ["85261234505"]], ["Example member five", "+85261234505"], ["NOBODY", "+85261234505"]]) {
      assert.throws(() => verifiedMemberCode(db, member, phone), /^Error: MEMBER_VERIFICATION_FAILED$/);
    }
    db.prepare("UPDATE bonus_members SET mobile='+85261234599' WHERE member_code='DF1005'").run();
    assert.throws(() => verifiedMemberCode(db, "DF1005", "+85261234505"), /MEMBER_VERIFICATION_FAILED/);
    assert.equal(verifiedMemberCode(db, "DF1005", "+85261234599"), "DF1005");
  } finally { db.close(); }
});
